import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify/adapters/fastify-adapter';
import type { NestFastifyApplication } from '@nestjs/platform-fastify/interfaces';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors();
  }

  const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  await app.listen(PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Error starting API Gateway:', err);
  process.exit(1);
});
