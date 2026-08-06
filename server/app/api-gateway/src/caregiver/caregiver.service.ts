import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaregiverPermission,
  RelationshipType,
} from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../redis/rate-limit.service';
import {
  CaregiverLinkStatusGql,
  CaregiverLinkType,
  CaregiverPermissionGql,
  PatientSummaryType,
} from './caregiver.types';

type CaregiverLinkWithUsers = {
  caregiverId: string;
  patientId: string;
  relationship: RelationshipType;
  status: 'pending' | 'accepted' | 'rejected';
  permission: CaregiverPermission;
  respondedAt: Date | null;
  caregiver: {
    firstname: string;
    lastname: string;
    phone: string;
    avatar: string | null;
  };
  patient: {
    firstname: string;
    lastname: string;
    phone: string;
    avatar: string | null;
  };
};

/**
 * Relationship values `addCaregiverPatient` accepts on the way in.
 *
 * **`caregiver` is in this set because the GraphQL default is `"caregiver"`.**
 * It was omitted, so the schema's own default failed the check and every
 * invite that relied on it was silently stored as `other` — the caller got a
 * 200 and the wrong row. Widening the set rather than changing the default
 * keeps existing clients working and makes the two agree.
 *
 * `patient` stays out. Prisma's enum has it, but this column describes the
 * caregiver's relationship *to* the patient, so "patient" is not an answer to
 * that question — it would only ever arrive from a caller confusing this
 * field with a role. Rows written before this rule can still come back as
 * either, which is why `modules/caregivers/lib/relationship.ts` on the client
 * carries a label for both.
 */
const VALID_RELATIONSHIPS: ReadonlySet<RelationshipType> = new Set([
  'parent',
  'child',
  'spouse',
  'sibling',
  'friend',
  'caregiver',
  'caregiver_professional',
  'other',
]);

const parseRelationship = (raw: string): RelationshipType => {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (VALID_RELATIONSHIPS.has(normalized as RelationshipType)) {
    return normalized as RelationshipType;
  }
  return 'other';
};

/**
 * Invite budget: 10 attempts per 10 minutes per caregiver.
 *
 * Generous enough that nobody adding their family hits it, tight enough that
 * enumerating an address space is not worth the wait.
 *
 * The window is fixed rather than sliding, matching `RateLimitService` — the
 * same primitive Better Auth's credential endpoints use. That inherits a known
 * weakness: a caller can spend 10 at 09:59 and another 10 at 10:01 for 20 in
 * two minutes. Accepted here, because switching to a sliding window means
 * changing the shared primitive and therefore changing login-throttle
 * behaviour too, which is a bigger blast radius than this mitigation warrants.
 * Filed separately.
 */
const INVITE_RATE_LIMIT = { window: 10 * 60, max: 10 };

/** Namespaced so it cannot collide with Better Auth's own limiter keys. */
const inviteRateLimitKey = (caregiverId: string) =>
  `ratelimit:caregiver-invite:${caregiverId}`;

@Injectable()
export class CaregiverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Spends one invite attempt, throwing 429 when the budget is gone.
   *
   * `app.module.ts` maps 429 to `extensions.code = 'TOO_MANY_REQUESTS'`, and
   * its `errorFormatter` lifts every non-envelope key of an HttpException body
   * into `extensions`. So `retryAfterSec` arrives at the client the same way
   * the credential endpoints already deliver it, and
   * `client/src/services/api.ts` reads it generically for every operation —
   * no client change is needed for the countdown to have a number to show.
   *
   * When Redis is unreachable this degrades to `RateLimitService`'s
   * per-process counter, which is the policy the repo already chose for the
   * login throttle. Neither fail-open nor fail-closed; one policy, one place.
   */
  private async assertInviteRateLimit(caregiverId: string): Promise<void> {
    const { allowed, retryAfter } = await this.rateLimit.consume(
      inviteRateLimitKey(caregiverId),
      INVITE_RATE_LIMIT,
    );

    if (allowed) return;

    throw new HttpException(
      {
        message: 'ส่งคำเชิญบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
        retryAfterSec: retryAfter ?? INVITE_RATE_LIMIT.window,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async list(userId: string): Promise<CaregiverLinkType[]> {
    const links = await this.prisma.caregiverPatient.findMany({
      where: {
        OR: [{ caregiverId: userId }, { patientId: userId }],
      },
      include: {
        caregiver: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
        patient: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
      },
      orderBy: [{ caregiverId: 'asc' }, { patientId: 'asc' }],
    });

    return links.map((link) => this.toType(link));
  }

  /**
   * Invites a patient addressed by phone *or* email.
   *
   * The two are told apart by a plain `includes('@')`, and that is the
   * load-bearing assumption of the whole design: a Thai phone number is
   * digits with at most `+`, spaces or dashes around them, so it can never
   * contain `@`, while an email address always does. Because the split can
   * never be ambiguous, the mutation takes one polymorphic `patientContact`
   * argument rather than two mutually exclusive optional ones — the client
   * does not have to guess which field to fill, and there is no "both given"
   * or "neither given" state to validate.
   *
   * The error messages stay split even though the lookup is unified: telling
   * someone who typed an email that we could not find that *phone number*
   * reads as a bug on the client.
   */
  async add(
    caregiverId: string,
    patientContact: string,
    relationship: string,
  ): Promise<CaregiverLinkType> {
    // Counted before anything else, and keyed on the *caregiver*, not on the
    // contact string. Keying on the contact would let an attacker rotate
    // addresses and never spend a budget — which is precisely the attack this
    // exists to stop, since `ไม่พบผู้ใช้จากอีเมลนี้` is an honest answer to
    // "does this address have an account here?" and email addresses are far
    // easier to guess than Thai phone numbers. The honest message is a
    // deliberate UX choice; this is its mitigation.
    //
    // Every attempt counts, found or not-found, valid or malformed. Counting
    // only failures would hand out a free attempt on every successful guess,
    // and a successful lookup is the information being protected.
    await this.assertInviteRateLimit(caregiverId);

    const contact = patientContact.trim();
    if (!contact) {
      throw new BadRequestException(
        'กรุณากรอกเบอร์โทรศัพท์หรืออีเมลของผู้ป่วย',
      );
    }

    const isEmail = contact.includes('@');

    const relationshipEnum = parseRelationship(relationship);

    // Emails are stored lowercase: Better Auth lowercases on every write path
    // it owns (`/sign-up/email`, its `update-user` route, and the internal
    // adapter's create/update), which is every path that currently creates an
    // account here. So lowercasing the input is enough to make the match
    // case-insensitive in practice, and the lookup still rides the `email`
    // unique index — no `mode: 'insensitive'` sequential scan on a table that
    // grows with every user.
    //
    // The one write that bypasses Better Auth is `AuthService.updateProfile`,
    // which patches `email` straight through Prisma without normalising. It
    // has not produced a mixed-case row yet, but it could; the fix belongs at
    // that write, not in a slower read here.
    const patient = await this.prisma.user.findUnique({
      where: isEmail ? { email: contact.toLowerCase() } : { phone: contact },
      select: { id: true },
    });

    if (!patient) {
      throw new NotFoundException(
        isEmail ? 'ไม่พบผู้ใช้จากอีเมลนี้' : 'ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้',
      );
    }

    if (patient.id === caregiverId) {
      throw new BadRequestException('ไม่สามารถเพิ่มตัวเองเป็นผู้ป่วยได้');
    }

    const existing = await this.prisma.caregiverPatient.findUnique({
      where: {
        caregiverId_patientId: {
          caregiverId,
          patientId: patient.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException('มีความสัมพันธ์นี้อยู่แล้ว');
    }

    // ส่งคำเชิญแบบ pending — ผู้ป่วยต้องกด accept ก่อน caregiver ถึงเห็นข้อมูล
    const link = await this.prisma.caregiverPatient.create({
      data: {
        caregiverId,
        patientId: patient.id,
        relationship: relationshipEnum,
        status: 'pending',
      },
      include: {
        caregiver: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
        patient: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });

    return this.toType(link);
  }

  async remove(
    userId: string,
    caregiverId: string,
    patientId: string,
  ): Promise<boolean> {
    if (userId !== caregiverId && userId !== patientId) {
      throw new ForbiddenException('ลบได้เฉพาะความสัมพันธ์ที่เกี่ยวข้องกับคุณ');
    }

    const existing = await this.prisma.caregiverPatient.findUnique({
      where: { caregiverId_patientId: { caregiverId, patientId } },
    });

    if (!existing) {
      return false;
    }

    await this.prisma.caregiverPatient.delete({
      where: { caregiverId_patientId: { caregiverId, patientId } },
    });
    return true;
  }

  /**
   * ผู้ป่วยตอบรับ/ปฏิเสธคำเชิญจาก caregiver
   * เรียกจากฝั่ง patient เท่านั้น
   *
   * `permission` is written **only on accept**, and only here: the grant is
   * the patient's to make, so `addCaregiverPatient` has no say in it and the
   * column keeps its `full` default until this runs. Writing it on a reject
   * as well would leave a rejected row claiming a permission nobody granted,
   * which the next accept would then have to remember to overwrite.
   */
  async respondToInvite(
    patientId: string,
    caregiverId: string,
    accept: boolean,
    permission: CaregiverPermission = 'full',
  ): Promise<CaregiverLinkType> {
    const link = await this.prisma.caregiverPatient.findUnique({
      where: { caregiverId_patientId: { caregiverId, patientId } },
      include: {
        caregiver: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
        patient: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });

    if (!link) {
      throw new NotFoundException('ไม่พบคำเชิญนี้');
    }

    if (link.status !== 'pending') {
      throw new BadRequestException('คำเชิญนี้ตอบรับ/ปฏิเสธไปแล้ว');
    }

    const updated = await this.prisma.caregiverPatient.update({
      where: { caregiverId_patientId: { caregiverId, patientId } },
      data: {
        status: accept ? 'accepted' : 'rejected',
        respondedAt: new Date(),
        ...(accept ? { permission } : {}),
      },
      include: {
        caregiver: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
        patient: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });

    return this.toType(updated);
  }

  /**
   * ผู้ป่วยเปลี่ยนสิทธิ์ของผู้ดูแลที่ตอบรับไปแล้ว
   * เรียกจากฝั่ง patient เท่านั้น
   *
   * Until this existed the only route from `full` back to `view` was removing
   * the link and being re-invited — which drops the relationship, its history,
   * and the caregiver's access all at once to change one column. A patient who
   * wants to keep someone reading but stop them writing had to revoke
   * everything and start over, so in practice nobody downgraded.
   *
   * **The patient id comes from the session, never from an argument.** That is
   * what makes this patient-only: a caregiver calling it looks up a row where
   * *they* are the patient, which is not the link they are trying to widen.
   * There is no `patientId` parameter to get the authorization check wrong on.
   *
   * **Accepted links only.** A `pending` row's permission column holds the
   * default, not a decision — writing to it would pre-answer a question the
   * patient has not been asked, and `respondToInvite` would then overwrite it
   * anyway. A `rejected` row grants nothing to change. Both raise rather than
   * silently succeeding, because a client showing a permission control on a
   * row where it does nothing is the bug this would hide.
   */
  async updatePermission(
    patientId: string,
    caregiverId: string,
    permission: CaregiverPermission,
  ): Promise<CaregiverLinkType> {
    const link = await this.prisma.caregiverPatient.findUnique({
      where: { caregiverId_patientId: { caregiverId, patientId } },
      select: { status: true },
    });

    if (!link) {
      throw new NotFoundException('ไม่พบผู้ดูแลรายนี้');
    }

    if (link.status !== 'accepted') {
      throw new BadRequestException(
        'เปลี่ยนสิทธิ์ได้เฉพาะผู้ดูแลที่ตอบรับคำเชิญแล้ว',
      );
    }

    const updated = await this.prisma.caregiverPatient.update({
      where: { caregiverId_patientId: { caregiverId, patientId } },
      data: { permission },
      include: {
        caregiver: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
        patient: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });

    return this.toType(updated);
  }

  /**
   * รายชื่อผู้ป่วยที่ caregiver ดูแลอยู่ (เฉพาะ accepted)
   */
  async myPatients(caregiverId: string): Promise<PatientSummaryType[]> {
    const links = await this.prisma.caregiverPatient.findMany({
      where: { caregiverId, status: 'accepted' },
      include: {
        patient: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            phone: true,
            avatar: true,
            dob: true,
            weight: true,
            height: true,
          },
        },
      },
      orderBy: { patientId: 'asc' },
    });

    if (links.length === 0) return [];

    /*
     * One grouped query for every patient's newest reading, rather than one
     * per patient. `distinct` with the matching `orderBy` is Prisma's
     * "first row per group" — it returns at most one reading per userId.
     */
    const latest = await this.prisma.bloodPressureReading.findMany({
      where: { userId: { in: links.map((link) => link.patientId) } },
      distinct: ['userId'],
      orderBy: [{ userId: 'asc' }, { measuredAt: 'desc' }],
      select: {
        userId: true,
        systolic: true,
        diastolic: true,
        pulse: true,
        status: true,
        measuredAt: true,
      },
    });
    const latestByPatient = new Map(latest.map((row) => [row.userId, row]));

    return links.map((link) => ({
      permission: link.permission,
      latestReading: latestByPatient.get(link.patientId)
        ? {
            systolic: latestByPatient.get(link.patientId)!.systolic,
            diastolic: latestByPatient.get(link.patientId)!.diastolic,
            pulse: latestByPatient.get(link.patientId)!.pulse,
            status: latestByPatient.get(link.patientId)!.status,
            measuredAt: latestByPatient.get(link.patientId)!.measuredAt,
          }
        : undefined,
      id: link.patient.id,
      firstname: link.patient.firstname,
      lastname: link.patient.lastname,
      phone: link.patient.phone,
      avatar: link.patient.avatar ?? undefined,
      dob: link.patient.dob ?? undefined,
      relationship: link.relationship,
      weight: link.patient.weight ?? undefined,
      height: link.patient.height ?? undefined,
    }));
  }

  /**
   * The accepted link, or `null`. Acting on yourself is not a link and is
   * handled by the callers below.
   */
  private async findAcceptedLink(actorId: string, patientId: string) {
    const link = await this.prisma.caregiverPatient.findUnique({
      where: { caregiverId_patientId: { caregiverId: actorId, patientId } },
      select: { status: true, permission: true },
    });
    return link && link.status === 'accepted' ? link : null;
  }

  /**
   * ตรวจว่า actor มีสิทธิ์**ดู**ข้อมูลของ patient หรือไม่
   *
   * Any accepted link may read — `view` and `full` differ only on writes.
   */
  async assertCanViewPatient(
    actorId: string,
    patientId: string,
  ): Promise<void> {
    if (actorId === patientId) return;

    if (!(await this.findAcceptedLink(actorId, patientId))) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้');
    }
  }

  /**
   * ตรวจว่า actor มีสิทธิ์**บันทึก**ข้อมูลแทน patient หรือไม่
   *
   * Stricter than viewing: a `view` link is refused. The two were one check
   * until the permission column existed, which meant every accepted link
   * could write a blood-pressure reading into someone else's medical history.
   * Splitting them is the entire point of that column — a distinct message so
   * the client can tell "you are not linked" from "you are linked, read-only",
   * which are different problems with different fixes.
   */
  async assertCanRecordForPatient(
    actorId: string,
    patientId: string,
  ): Promise<void> {
    if (actorId === patientId) return;

    const link = await this.findAcceptedLink(actorId, patientId);
    if (!link) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้');
    }
    if (link.permission !== 'full') {
      throw new ForbiddenException(
        'คุณดูข้อมูลของผู้ป่วยรายนี้ได้อย่างเดียว ไม่สามารถบันทึกแทนได้',
      );
    }
  }

  private toType(link: CaregiverLinkWithUsers): CaregiverLinkType {
    return {
      caregiverId: link.caregiverId,
      patientId: link.patientId,
      relationship: link.relationship,
      caregiverName:
        `${link.caregiver.firstname} ${link.caregiver.lastname}`.trim(),
      caregiverPhone: link.caregiver.phone,
      caregiverAvatar: link.caregiver.avatar ?? undefined,
      patientName: `${link.patient.firstname} ${link.patient.lastname}`.trim(),
      patientPhone: link.patient.phone,
      patientAvatar: link.patient.avatar ?? undefined,
      status: link.status as CaregiverLinkStatusGql,
      permission: link.permission as CaregiverPermissionGql,
      respondedAt: link.respondedAt ?? undefined,
    };
  }
}
