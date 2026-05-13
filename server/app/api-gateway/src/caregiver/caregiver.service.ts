import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RelationshipType } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CaregiverLinkType } from './caregiver.types';

type CaregiverLinkWithUsers = {
  caregiverId: string;
  patientId: string;
  relationship: RelationshipType;
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

    const link = await this.prisma.caregiverPatient.create({
      data: {
        caregiverId,
        patientId: patient.id,
        relationship: relationshipEnum,
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
    };
  }
}
