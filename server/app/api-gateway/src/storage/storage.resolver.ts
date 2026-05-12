import { Logger, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConfirmImageUploadInput } from './dto/confirm-image-upload.input';
import { ConfirmedImageObject } from './dto/confirmed-image.object';
import { PresignedUploadObject } from './dto/presigned-upload.object';
import { RequestImageUploadInput } from './dto/request-image-upload.input';
import { SyncStorageImagesObject } from './dto/sync-storage-images.object';
import { UploadImageInput } from './dto/upload-image.input';
import { UploadedImageObject } from './dto/uploaded-image.object';
import { PresignedUploadService } from './presigned-upload.service';
import { StorageService } from './storage.service';
import { ImageKind } from './types/storage.types';

@Resolver()
@UseGuards(GqlAuthGuard)
export class StorageResolver {
  private readonly logger = new Logger(StorageResolver.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly presignedUploadService: PresignedUploadService,
  ) {}

  // ── Presigned (direct-to-S3) flow ────────────────────────────────────────

  @Mutation(() => PresignedUploadObject, {
    description: 'ขอ presigned URL เพื่ออัปโหลดรูปตรงสู่ S3',
  })
  async requestImageUpload(
    @CurrentUser() user: { id: string },
    @Args('input') input: RequestImageUploadInput,
  ): Promise<PresignedUploadObject> {
    return this.presignedUploadService.request(user.id, input);
  }

  @Mutation(() => ConfirmedImageObject, {
    description: 'ยืนยันการอัปโหลด หลัง PUT ไป S3 สำเร็จ',
  })
  async confirmImageUpload(
    @CurrentUser() user: { id: string },
    @Args('input') input: ConfirmImageUploadInput,
  ): Promise<ConfirmedImageObject> {
    return this.presignedUploadService.confirm(user.id, input);
  }

  // ── Legacy base64-through-gateway flow (deprecated, kept during migration) ──

  @Mutation(() => UploadedImageObject, {
    description:
      'อัปโหลดรูปโปรไฟล์เข้า S3 (deprecated: ใช้ requestImageUpload)',
  })
  async uploadProfileImage(
    @CurrentUser() user: { id: string },
    @Args('input') input: UploadImageInput,
  ): Promise<UploadedImageObject> {
    this.logger.log(
      `uploadProfileImage userId=${user.id} mimeType=${input.mimeType} base64Length=${input.base64.length}`,
    );
    return this.storageService.uploadImage({
      userId: user.id,
      kind: ImageKind.PROFILE,
      base64: input.base64,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
  }

  @Mutation(() => UploadedImageObject, {
    description:
      'อัปโหลดรูปเครื่องวัดความดันเข้า S3 (deprecated: ใช้ requestImageUpload)',
  })
  async uploadBloodPressureImage(
    @CurrentUser() user: { id: string },
    @Args('input') input: UploadImageInput,
  ): Promise<UploadedImageObject> {
    this.logger.log(
      `uploadBloodPressureImage userId=${user.id} mimeType=${input.mimeType} base64Length=${input.base64.length}`,
    );
    return this.storageService.uploadImage({
      userId: user.id,
      kind: ImageKind.BLOOD_PRESSURE_READING,
      base64: input.base64,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
  }

  @Mutation(() => SyncStorageImagesObject, {
    description: 'ซิงก์รูปเครื่องวัดความดันจาก S3 prefix เข้า table images',
  })
  async syncBloodPressureImagesFromStorage(
    @CurrentUser() user: { id: string },
    @Args('prefix', { nullable: true }) prefix?: string,
  ): Promise<SyncStorageImagesObject> {
    return this.storageService.syncBloodPressureImagesFromPrefix(
      user.id,
      prefix,
    );
  }
}
