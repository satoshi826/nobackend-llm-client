// Every feature module. Each one registers itself with the core through extension points
// (src/components/extensions.ts, src/state/tool-registry.ts, src/state/router.ts, src/state/lifecycle.ts,
// lib/chat/request.ts) when imported. The order sets the order of input-box buttons, settings tabs
// and message transforms (skills are put before attached files).
import './images';
import './web';
import './skills';
import './files';
import './usage';
