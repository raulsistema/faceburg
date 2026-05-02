import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STORIES = 12;

type MenuStoryRow = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
  expires_at: string | null;
};

function estimateDataUrlBytes(value: string) {
  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return 0;
  const base64 = value.slice(commaIndex + 1);
  return Math.floor((base64.length * 3) / 4);
}

function validateImagePayload(imageUrl: string) {
  if (!imageUrl) return 'Adicione uma imagem ao story.';
  if (!imageUrl.startsWith('data:image/')) return null;
  const bytes = estimateDataUrlBytes(imageUrl);
  if (!bytes || bytes > MAX_IMAGE_BYTES) {
    return 'Imagem deve ter no maximo 5 MB.';
  }
  return null;
}

function normalizeStoriesInput(rawStories: unknown[]) {
  return rawStories.map((story, index) => {
    const record = story && typeof story === 'object' ? (story as Record<string, unknown>) : {};
    const title = String(record.title ?? '').trim();
    const subtitle = String(record.subtitle ?? '').trim();
    const imageUrl = String(record.imageUrl ?? '').trim();
    const expiresAtRaw = String(record.expiresAt ?? '').trim();
    const displayOrderValue = Number(record.displayOrder ?? index);
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

    if (!title) {
      throw new Error(`Preencha o titulo do story ${index + 1}.`);
    }

    const imageValidationError = validateImagePayload(imageUrl);
    if (imageValidationError) {
      throw new Error(imageValidationError);
    }

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new Error(`Data de expiracao invalida no story ${index + 1}.`);
    }

    return {
      id: String(record.id || '').trim() || randomUUID(),
      title,
      subtitle,
      imageUrl,
      active: Boolean(record.active ?? true),
      displayOrder: Number.isFinite(displayOrderValue) ? Math.max(0, Math.round(displayOrderValue)) : index,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    };
  });
}

async function fetchStories(tenantId: string) {
  const result = await query<MenuStoryRow>(
    `SELECT id,
            title,
            subtitle,
            image_url,
            active,
            display_order,
            expires_at
       FROM menu_stories
      WHERE tenant_id = $1
      ORDER BY display_order ASC, created_at ASC`,
    [tenantId],
  );

  return result.rows.map((story) => ({
    id: story.id,
    title: story.title,
    subtitle: story.subtitle || '',
    imageUrl: story.image_url,
    active: Boolean(story.active),
    displayOrder: Number(story.display_order || 0),
    expiresAt: story.expires_at,
  }));
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stories = await fetchStories(session.tenantId);
  return NextResponse.json({ stories });
}

export async function PATCH(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rawStories = Array.isArray(body.stories) ? body.stories : [];
  if (rawStories.length > MAX_STORIES) {
    return NextResponse.json({ error: `Voce pode salvar no maximo ${MAX_STORIES} stories.` }, { status: 400 });
  }

  let stories: Array<{
    id: string;
    title: string;
    subtitle: string;
    imageUrl: string;
    active: boolean;
    displayOrder: number;
    expiresAt: string | null;
  }> = [];

  try {
    stories = normalizeStoriesInput(rawStories);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao validar stories.' },
      { status: 400 },
    );
  }

  await query('SELECT 1');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM menu_stories WHERE tenant_id = $1', [session.tenantId]);

    for (const story of stories) {
      await client.query(
        `INSERT INTO menu_stories
         (id, tenant_id, title, subtitle, image_url, active, display_order, expires_at, created_at, updated_at)
         VALUES
         ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, NOW(), NOW())`,
        [
          story.id,
          session.tenantId,
          story.title,
          story.subtitle,
          story.imageUrl,
          story.active,
          story.displayOrder,
          story.expiresAt,
        ],
      );
    }

    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao salvar stories da loja.' }, { status: 500 });
  } finally {
    client.release();
  }

  const savedStories = await fetchStories(session.tenantId);
  return NextResponse.json({ stories: savedStories });
}
