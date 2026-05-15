import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PostService } from './post.service';
import { PostResolver } from './post.resolver';

@Module({
  imports: [StorageModule],
  providers: [PostService, PostResolver],
})
export class PostModule {}
