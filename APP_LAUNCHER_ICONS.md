# App launcher icon repair

The module icon decorator selected the first `i` inside each app card. In the launcher that is the favourite star, so the main app icon never received its module artwork. The improvement stylesheet then removed every app icon's coloured background, leaving its white font glyph on a white surface.

The decorator now selects the main icon inside `.auris-app-card-icon` for launcher cards. Sidebar and mobile navigation keep their existing icon selection. Transparent backgrounds apply only when module artwork is present; My Work and Master Data keep visible coloured fallback icons.

Browser verification used the actual launcher renderer, module registry, icon decorator and styles: 39 app cards, 37 module artwork icons, two coloured fallbacks, and no favourite stars decorated as module icons. Search, adding a favourite, rebuilding the launcher and opening an app were checked. The existing icon contract tests pass. No database changes are required.
