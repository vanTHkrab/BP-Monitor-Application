import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('HttpHeader')
export class HttpHeaderObject {
  @Field(() => String)
  name: string;

  @Field(() => String)
  value: string;
}

@ObjectType('PresignedUpload')
export class PresignedUploadObject {
  @Field(() => String, {
    description: 'Presigned URL — client PUTs the image body here.',
  })
  uploadUrl: string;

  @Field(() => String, {
    description: 'Echo back to confirmImageUpload after PUT succeeds.',
  })
  key: string;

  @Field(() => [HttpHeaderObject], {
    description: 'Headers required on the PUT request.',
  })
  headers: HttpHeaderObject[];

  @Field(() => Date, { description: 'URL becomes invalid at this time.' })
  expiresAt: Date;
}
