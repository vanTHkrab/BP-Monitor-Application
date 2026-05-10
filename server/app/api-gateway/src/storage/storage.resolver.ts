import { Logger, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StorageService } from './storage.service';
import {
  SyncStorageImagesType,
  UploadedImageType,
  UploadImageInput,
} from './storage.types';

@Resolver()
export class StorageResolver {
  private readonly logger = new Logger(StorageResolver.name);

  constructor(private readonly storageService: StorageService) {}

  @Mutation(() => UploadedImageType, {
    description: 'อัปโหลดรูปโปรไฟล์เข้า S3',
  })
  @UseGuards(GqlAuthGuard)
  async uploadProfileImage(
    @CurrentUser() user: { id: string },
    @Args('input') input: UploadImageInput,
  ): Promise<UploadedImageType> {
    this.logger.log(
      `Mutation reached uploadProfileImage userId=${user.id} mimeType=${input.mimeType} base64Length=${input.base64?.length ?? 0}`,
    );
    return this.storageService.uploadImage({
      userId: user.id,
      kind: 'profile',
      ...input,
    });
  }

  @Mutation(() => UploadedImageType, {
    description: 'อัปโหลดรูปเครื่องวัดความดันเข้า S3',
  })
  @UseGuards(GqlAuthGuard)
  async uploadBloodPressureImage(
    @CurrentUser() user: { id: string },
    @Args('input') input: UploadImageInput,
  ): Promise<UploadedImageType> {
    this.logger.log(
      `Mutation reached uploadBloodPressureImage userId=${user.id} mimeType=${input.mimeType} base64Length=${input.base64?.length ?? 0}`,
    );
    return this.storageService.uploadImage({
      userId: user.id,
      kind: 'blood-pressure-reading',
      ...input,
    });
  }

  @Mutation(() => SyncStorageImagesType, {
    description: 'ซิงก์รูปเครื่องวัดความดันจาก S3 prefix เข้า table images',
  })
  @UseGuards(GqlAuthGuard)
  async syncBloodPressureImagesFromStorage(
    @CurrentUser() user: { id: string },
    @Args('prefix', { nullable: true }) prefix?: string,
  ): Promise<SyncStorageImagesType> {
    return this.storageService.syncBloodPressureImagesFromPrefix(
      user.id,
      prefix,
    );
  }
}
