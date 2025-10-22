/**
 * Realistic Angular CLI JSON output samples for testing
 */

export const ANGULAR_BUILD_START_JSON = JSON.stringify({
  type: 'build-start',
  message: 'Building Angular application...',
});

export const ANGULAR_BUILD_PROGRESS_JSON = [
  JSON.stringify({
    type: 'build-progress',
    progress: 10,
    message: 'Building Angular application...',
  }),
  JSON.stringify({
    type: 'build-progress',
    progress: 25,
    message: 'Generating bundles...',
  }),
  JSON.stringify({
    type: 'build-progress',
    progress: 50,
    message: 'Optimizing bundles...',
  }),
  JSON.stringify({
    type: 'build-progress',
    progress: 75,
    message: 'Copying assets...',
  }),
  JSON.stringify({
    type: 'build-progress',
    progress: 90,
    message: 'Generating index html...',
  }),
];

export const ANGULAR_BUILD_COMPLETE_SUCCESS_JSON = JSON.stringify({
  type: 'build-complete',
  success: true,
  time: 2547,
  errors: [],
  warnings: [],
});

export const ANGULAR_BUILD_COMPLETE_WITH_WARNINGS_JSON = JSON.stringify({
  type: 'build-complete',
  success: true,
  time: 3124,
  errors: [],
  warnings: [
    'Warning: CommonJS or AMD dependencies can cause optimization bailouts.',
    'Warning: ./node_modules/moment/moment.js is a CommonJS module',
  ],
});

export const ANGULAR_BUILD_COMPLETE_WITH_ERRORS_JSON = JSON.stringify({
  type: 'build-complete',
  success: false,
  time: 1234,
  errors: [
    "Error: src/app/app.component.ts:10:5 - error TS2304: Cannot find name 'foo'.",
    "Error: src/app/app.component.ts:15:10 - error TS2339: Property 'bar' does not exist on type 'AppComponent'.",
  ],
  warnings: ['Warning: Entry point is missing exports'],
});

export const ANGULAR_BUILD_ERROR_JSON = JSON.stringify({
  type: 'build-error',
  message: 'Build failed with compilation errors',
  errors: ['Fatal error: Out of memory'],
});

/**
 * Realistic Angular CLI text output samples for testing
 */

export const ANGULAR_TEXT_INITIAL = `
⠙ Building...

Initial chunk files | Names         |  Raw size
polyfills.js        | polyfills     | 314.27 kB |
main.js             | main          |  50.79 kB |
styles.css          | styles        |   0 bytes |

                    | Initial total | 365.06 kB

Build at: 2024-01-15T10:30:45.123Z - Hash: abc123def456 - Time: 2547ms
`;

export const ANGULAR_TEXT_BUILD_SUCCESS = `
✔ Browser application bundle generation complete.
✔ Copying assets complete.
✔ Index html generation complete.

Initial chunk files   | Names         |  Raw size | Estimated transfer size
main.js               | main          |  50.79 kB |                14.23 kB
polyfills.js          | polyfills     | 314.27 kB |               101.23 kB
styles.css            | styles        |  15.34 kB |                 2.45 kB

                      | Initial total | 380.40 kB |               117.91 kB

Application bundle generation complete. [2.547 seconds]

Watch mode enabled. Watching for file changes...
`;

export const ANGULAR_TEXT_BUILD_WITH_WARNINGS = `
✔ Browser application bundle generation complete.

Warning: CommonJS or AMD dependencies can cause optimization bailouts.
For more info see: https://angular.io/guide/build#configuring-commonjs-dependencies

Warning: ./node_modules/moment/moment.js depends on 'moment'.
CommonJS or AMD dependencies can cause optimization bailouts.

Initial chunk files   | Names         |  Raw size | Estimated transfer size
main.js               | main          |  52.34 kB |                15.12 kB
polyfills.js          | polyfills     | 314.27 kB |               101.23 kB

                      | Initial total | 366.61 kB |               116.35 kB

Build at: 2024-01-15T10:31:20.456Z - Hash: def456ghi789 - Time: 3124ms

** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **
`;

export const ANGULAR_TEXT_BUILD_WITH_ERRORS = `
✖ Failed to compile.

src/app/app.component.ts:10:5 - error TS2304: Cannot find name 'foo'.

10     foo.bar();
       ~~~

src/app/app.component.ts:15:10 - error TS2339: Property 'bar' does not exist on type 'AppComponent'.

15   this.bar = 123;
            ~~~


Error: ./src/app/app.component.ts
Module build failed (from ./node_modules/@angular-devkit/build-angular/src/babel/webpack-loader.js):
Error: Failed to transpile

** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **

✖ Failed to compile.
`;

export const ANGULAR_TEXT_COMPILATION_PROGRESS = [
  '⠙ Building...',
  '⠹ Building...',
  '⠸ Generating browser application bundles (phase: setup)...',
  '⠼ Generating browser application bundles (phase: building)...',
  '⠴ Generating browser application bundles (phase: sealing)...',
  '⠦ Generating browser application bundles (phase: resource)...',
  '⠧ Generating browser application bundles (phase: optimizing)...',
  '✔ Browser application bundle generation complete.',
];

export const ANGULAR_TEXT_REBUILD = `
⠙ Building...

✔ Browser application bundle generation complete.

Initial chunk files   | Names         |  Raw size | Estimated transfer size
main.js               | main          |  51.02 kB |                14.45 kB
polyfills.js          | polyfills     | 314.27 kB |               101.23 kB

                      | Initial total | 365.29 kB |               115.68 kB

Build at: 2024-01-15T10:32:15.789Z - Hash: ghi789jkl012 - Time: 1245ms
`;

export const ANGULAR_TEXT_SERVER_LISTENING = `** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **`;

export const ANGULAR_TEXT_WEBPACK_COMPILED = `✔ Compiled successfully.`;

export const ANGULAR_TEXT_WEBPACK_COMPILING = `✔ Compiling...`;

export const ANGULAR_TEXT_HMR_UPDATE = `[webpack-dev-server] HMR connected
[webpack-dev-server] Live Reloading enabled
✔ Compiled successfully.`;
