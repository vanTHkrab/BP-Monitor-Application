import { Logger, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { GqlAuthGuard } from '../auth/auth.guard';
import { SyncStorageImagesObject } from './dto/sync-storage-images.object';
import { UploadImageInput } from './dto/upload-image.input';
import { UploadedImageObject } from './dto/uploaded-image.object';
import { StorageService } from './storage.service';

@Resolver()
@UseGuards(GqlAuthGuard)
export class StorageResolver {
  private readonly logger = new Logger(StorageResolver.name);

  constructor(private readonly storageService: StorageService) {}

  @Mutation(() => UploadedImageObject, {
    description: 'อัปโหลดรูปโปรไฟล์เข้า S3',
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
      kind: 'profile',
      base64: input.base64,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
  }

  @Mutation(() => UploadedImageObject, {
    description: 'อัปโหลดรูปเครื่องวัดความดันเข้า S3',
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
      kind: 'blood-pressure-reading',
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
