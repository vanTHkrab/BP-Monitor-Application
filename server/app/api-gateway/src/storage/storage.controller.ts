import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { StorageService } from './storage.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('image')
  async getImage(
    @Query('key') key: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StreamableFile> {
    const image = await this.storageService.getImageObject(key || '');

    res.header('Content-Type', image.contentType);
    res.header('Cache-Control', 'public, max-age=300');
    if (image.contentLength) {
      res.header('Content-Length', String(image.contentLength));
    }

    return new StreamableFile(image.body);
  }
}
