import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class AnalyzeImageInput {
  @Field({ description: 'ข้อมูลภาพที่เข้ารหัสเป็น Base64' })
  imageData: string;
}
