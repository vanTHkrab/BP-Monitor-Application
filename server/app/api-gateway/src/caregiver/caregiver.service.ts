import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RelationshipType } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  CaregiverLinkStatusGql,
  CaregiverLinkType,
  PatientSummaryType,
} from './caregiver.types';

type CaregiverLinkWithUsers = {
  caregiverId: string;
  patientId: string;
  relationship: RelationshipType;
  status: 'pending' | 'accepted' | 'rejected';
  respondedAt: Date | null;
  caregiver: {
    firstname: string;
    lastname: string;
    phone: string;
  };
  patient: {
    firstname: string;
    lastname: string;
    phone: string;
  };
};

const VALID_RELATIONSHIPS: ReadonlySet<RelationshipType> = new Set([
  'parent',
  'child',
  'spouse',
  'sibling',
  'friend',
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

@Injectable()
export class CaregiverService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<CaregiverLinkType[]> {
    const links = await this.prisma.caregiverPatient.findMany({
      where: {
        OR: [{ caregiverId: userId }, { patientId: userId }],
      },
      include: {
        caregiver: { select: { firstname: true, lastname: true, phone: true } },
        patient: { select: { firstname: true, lastname: true, phone: true } },
      },
      orderBy: [{ caregiverId: 'asc' }, { patientId: 'asc' }],
    });

    return links.map((link) => this.toType(link));
  }

  async add(
    caregiverId: string,
    patientPhone: string,
    relationship: string,
  ): Promise<CaregiverLinkType> {
    const cleanPhone = patientPhone.trim();
    if (!cleanPhone) {
      throw new BadRequestException('กรุณากรอกเบอร์โทรศัพท์ผู้ป่วย');
    }

    const relationshipEnum = parseRelationship(relationship);

    const patient = await this.prisma.user.findUnique({
      where: { phone: cleanPhone },
      select: { id: true },
    });

    if (!patient) {
      throw new NotFoundException('ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้');
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
        caregiver: { select: { firstname: true, lastname: true, phone: true } },
        patient: { select: { firstname: true, lastname: true, phone: true } },
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
   */
  async respondToInvite(
    patientId: string,
    caregiverId: string,
    accept: boolean,
  ): Promise<CaregiverLinkType> {
    const link = await this.prisma.caregiverPatient.findUnique({
      where: { caregiverId_patientId: { caregiverId, patientId } },
      include: {
        caregiver: { select: { firstname: true, lastname: true, phone: true } },
        patient: { select: { firstname: true, lastname: true, phone: true } },
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
      },
      include: {
        caregiver: { select: { firstname: true, lastname: true, phone: true } },
        patient: { select: { firstname: true, lastname: true, phone: true } },
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

    return links.map((link) => ({
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
   * คำเชิญที่ผู้ป่วยรอตอบ
   */
  async myPendingInvites(patientId: string): Promise<CaregiverLinkType[]> {
    const links = await this.prisma.caregiverPatient.findMany({
      where: { patientId, status: 'pending' },
      include: {
        caregiver: { select: { firstname: true, lastname: true, phone: true } },
        patient: { select: { firstname: true, lastname: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return links.map((link) => this.toType(link));
  }

  /**
   * ตรวจว่า actor มีสิทธิ์ดู/บันทึกข้อมูลของ patient หรือไม่
   * ผ่านถ้า actor === patient เอง หรือมี link `accepted`
   */
  async assertCanActOnBehalfOf(actorId: string, patientId: string): Promise<void> {
    if (actorId === patientId) return;

    const link = await this.prisma.caregiverPatient.findUnique({
      where: {
        caregiverId_patientId: {
          caregiverId: actorId,
          patientId,
        },
      },
      select: { status: true },
    });

    if (!link || link.status !== 'accepted') {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้');
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
      patientName: `${link.patient.firstname} ${link.patient.lastname}`.trim(),
      patientPhone: link.patient.phone,
      status: link.status as CaregiverLinkStatusGql,
      respondedAt: link.respondedAt ?? undefined,
    };
  }
}
