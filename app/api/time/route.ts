import type { NextRequest } from 'next/server';
import { childViewer } from '@/lib/server/auth';
import { clockSample } from '@/lib/server/clock';
import { json, failure, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const started = performance.now();
  try {
    if (!await childViewer(request)) throw new HttpError(401, 'authentication_required');
    return json({ clock: await clockSample(started) });
  } catch (error) { return failure(error); }
}
