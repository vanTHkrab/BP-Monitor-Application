// Re-export the native module. On web, it will be resolved to BPVisionModule.web.ts
// and on native platforms to BPVisionModule.ts
export { default } from './src/BPVisionModule';
export * from './src/BPVision.types';
