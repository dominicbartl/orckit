/**
 * Type declarations for omelette
 */

declare module 'omelette' {
  interface Completion {
    on(
      event: string,
      handler: (context: { reply: (items: string[]) => void; line: string; fragment: string }) => void
    ): void;
    init(): void;
    setupSh(): string;
  }

  function omelette(template: string): Completion;

  export default omelette;
}
