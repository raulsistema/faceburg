import { cookies } from 'next/headers';
import { MASTER_SESSION_COOKIE_NAME, parseMasterSession } from '@/lib/master-session';

export async function requireMasterSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(MASTER_SESSION_COOKIE_NAME)?.value;
  return parseMasterSession(token);
}
