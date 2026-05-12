import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConfirmImageUploadInput } from './dto/confirm-image-upload.input';
import { ConfirmedImageObject } from './dto/confirmed-image.object';
import { PresignedUploadObject } from './dto/presigned-upload.object';
import { RequestImageUploadInput } from './dto/request-image-upload.input';
import { PresignedUploadService } from './presigned-upload.service';

@Resolver()
@UseGuards(GqlAuthGuard)
export class StorageResolver {
  constructor(
    private readonly presignedUploadService: PresignedUploadService,
  ) {}

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
}
