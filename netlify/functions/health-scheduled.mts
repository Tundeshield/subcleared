import type { Config } from '@netlify/functions';
import { checkJobHealth } from '../../server/ops';
import { getFirebaseServices } from '../../server/services';

// Every 30 minutes, separately from the scheduler it watches: alerts the operator if the hourly jobs stop.
export default async () => {
  const svc = await getFirebaseServices();
  const r = await checkJobHealth(svc);
  if (r.alerted) console.log('[health]', JSON.stringify(r));
};

export const config: Config = { schedule: '*/30 * * * *' };
