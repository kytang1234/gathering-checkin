import { registerAuthRoutes } from './auth.mjs';
import { registerDashboardRoutes } from './dashboard.mjs';
import { registerEventRoutes } from './events.mjs';
import { registerRosterRoutes } from './roster.mjs';
import { registerCheckinRoutes } from './checkin.mjs';
import { registerSummaryRoutes } from './summary.mjs';
import { registerQrRoutes } from './qr.mjs';
import { registerPublicRoutes } from './public.mjs';

export function registerRoutes(router) {
  registerAuthRoutes(router);
  registerDashboardRoutes(router);
  registerEventRoutes(router);
  registerRosterRoutes(router);
  registerCheckinRoutes(router);
  registerSummaryRoutes(router);
  registerQrRoutes(router);
  registerPublicRoutes(router);
  return router;
}
