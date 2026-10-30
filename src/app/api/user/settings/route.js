import { NextResponse } from 'next/server';
import { getUserSettings, updateUserSettings, verifySessionToken } from '@/lib/userRepository';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId requerido' }, { status: 400 });
    }

    // Opcional verificación de token en GET
    const authHeader = request.headers.get('authorization');
    const tokenUserId = verifySessionToken(authHeader);
    if (tokenUserId && tokenUserId !== userId) {
      return NextResponse.json({ error: 'Acceso no autorizado' }, { status: 403 });
    }

    const settings = await getUserSettings(userId);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, concepto_template, default_rate } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId requerido' }, { status: 400 });
    }

    // Verificación de seguridad de sesión: comprobar firma del token
    const authHeader = request.headers.get('authorization');
    const tokenUserId = verifySessionToken(authHeader);
    if (tokenUserId && tokenUserId !== userId) {
      return NextResponse.json({ error: 'Token de sesión no coincide con el usuario' }, { status: 403 });
    }

    const updated = await updateUserSettings(userId, { concepto_template, default_rate });
    return NextResponse.json({ success: true, settings: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
