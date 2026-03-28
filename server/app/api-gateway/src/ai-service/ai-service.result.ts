import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class BpAnalysisResult {
  @Field(() => String, { description: 'id ของผลการวิเคราะห์' })
  id: string;

  @Field(() => Int, { description: 'ค่าความดันตัวบน' })
  systolic: number;

  @Field(() => Int, { description: 'ค่าความดันตัวล่าง' })
  diastolic: number;

  @Field(() => Int, { description: 'อัตราการเต้นของหัวใจ' })
  pulse: number;

  @Field(() => Float, { nullable: true, description: 'ความมั่นใจของ AI' })
  confidence?: number;
}
