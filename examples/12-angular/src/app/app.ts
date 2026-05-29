import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [],
  template: `
    <main>
      <h1>{{ title() }}</h1>
      <p>A very simple Angular app, started and watched by orckit.</p>
      <p class="hint">Edit <code>src/app/app.ts</code> — orckit's dashboard shows the rebuild.</p>
    </main>
  `,
  styles: [
    `
      main {
        font-family: system-ui, sans-serif;
        max-width: 32rem;
        margin: 4rem auto;
        padding: 0 1rem;
        line-height: 1.5;
      }
      h1 {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }
      .hint {
        color: #666;
      }
      code {
        background: #f2f2f2;
        padding: 0.1rem 0.3rem;
        border-radius: 3px;
      }
    `,
  ],
})
export class App {
  protected readonly title = signal('orckit × Angular');
}
