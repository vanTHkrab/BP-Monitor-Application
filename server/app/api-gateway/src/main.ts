import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 16 * 1024 * 1024,
    }),
  );

  // Validate every @Args / @Body / @Query input against its class-validator
  // decorators. Strip unknown fields, transform plain JSON into class instances
  // so @IsDate() etc. fire correctly.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors();
  }

  const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  await app.listen(PORT, '0.0.0.0');
  console.log(`API Gateway is running on port ${PORT}`);
  console.log(`GraphQL endpoint available at http://localhost:${PORT}/graphql`);
}

bootstrap().catch((err) => {
  console.error('Error starting API Gateway:', err);
  process.exit(1);
});
