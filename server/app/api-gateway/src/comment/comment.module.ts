import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';

@Module({
  imports: [StorageModule],
  providers: [CommentResolver, CommentService],
})
export class CommentModule {}
