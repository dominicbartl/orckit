# Changelog

## [0.3.0](https://github.com/dominicbartl/orckit/compare/v0.2.0...v0.3.0) (2026-05-30)


### Features

* add `finished` lifecycle state for one-shot processes ([7e22b76](https://github.com/dominicbartl/orckit/commit/7e22b7628e9b023491a840e3b0fd7bd4c09e2522))
* built-in MCP server in orc start ([d12594c](https://github.com/dominicbartl/orckit/commit/d12594c3c05a6f8bb71c11e7a9ea4f1b0f87cbab))
* **docker:** force-remove containers after stop, drop stop_command default ([42e711d](https://github.com/dominicbartl/orckit/commit/42e711d652c473c8100535afede4b975623db059))
* hook_timeout_ms + Angular esbuild parser, pre_start failure handling ([ebc4ea2](https://github.com/dominicbartl/orckit/commit/ebc4ea232e519dcd8afb89211ce9059b725e1945))
* in-process web dashboard ([ad4526e](https://github.com/dominicbartl/orckit/commit/ad4526e5b63a8dfe5ed4b362ff09ef019bd40772))
* live boot view with dependency-graph rendering ([5a81b72](https://github.com/dominicbartl/orckit/commit/5a81b72d0a42914b61305dd91cee3fc046d5932e))
* log-file reporter — per-process files with session banners ([010504b](https://github.com/dominicbartl/orckit/commit/010504b368b4a56044d8df98e1ae6cc0a2f83be5))
* make manual-retry opt-in per process via manual_retry ([ad971a4](https://github.com/dominicbartl/orckit/commit/ad971a4c648cc952fe1dfd1ab926d1913bb0aea2))
* optional processes — opt-in start, --with flag, web ▶, REPL `start` ([10bf9ff](https://github.com/dominicbartl/orckit/commit/10bf9ff0ce0984835e3ae707eb9ac221afb1372a))
* orphan-port teardown backstop + process-group kill ([206a7dc](https://github.com/dominicbartl/orckit/commit/206a7dc4c95ca63eac34ac1be6e3a3aba5eddeaf))
* **parsers:** build-status reducer + richer angular/webpack failures ([d7d05fc](https://github.com/dominicbartl/orckit/commit/d7d05fcbc97662e3d3a4829a4ffaab56194a1534))
* pre-spawn port-conflict guard for tcp/http ready checks ([c8f8ed1](https://github.com/dominicbartl/orckit/commit/c8f8ed132263e75664da8070fef3303f3f1ee30a))
* support stop_command for CLI-client processes ([5d415cf](https://github.com/dominicbartl/orckit/commit/5d415cf304f8a9ed5bccadf1912617213e0b12c5))
* type: docker process type with auto orphan-cleanup ([30ad95f](https://github.com/dominicbartl/orckit/commit/30ad95fb044b704b3e213b4c560f89b547603f0e))
* verbose shutdown reporter ([be3c93f](https://github.com/dominicbartl/orckit/commit/be3c93ffe80ad477bd78967b88bc5039d2c97806))
* **web:** IDE deep links and build-state badges ([1806bd6](https://github.com/dominicbartl/orckit/commit/1806bd6a2e80d03d8ae38fe3d0df16e76f93003d))


### Bug Fixes

* default restart policy to never ([6c56b85](https://github.com/dominicbartl/orckit/commit/6c56b859ec2de99f584c75bd6df10aa466d81a3a))
* make examples runnable — pnpm --ignore-workspace + visible hooks ([09b0d7e](https://github.com/dominicbartl/orckit/commit/09b0d7eeeabbf8a5f16b24252804c74f9c723654))


### Code Refactoring

* extract bindLineStream shared line reader ([e281aa6](https://github.com/dominicbartl/orckit/commit/e281aa69dfbdbf89a1a0c637ec74fea95b700303))


### Documentation

* branded README — logo SVGs, hero, and dashboard preview ([2a55e94](https://github.com/dominicbartl/orckit/commit/2a55e94dca2a3ce2ba4233635fb9968f59bfb497))
