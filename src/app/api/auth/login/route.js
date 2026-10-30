import { NextResponse } from 'next/server';
import { authenticateLocalUser } from '@/lib/userRepository';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
    }

    const authResult = await authenticateLocalUser(username, password);

    if (!authResult) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: authResult.user,
      settings: authResult.settings,
      token: authResult.token,
    });
  } catch (error) {
    console.error('Error en /api/auth/login:', error);
    return NextResponse.json({ error: 'Error interno de autenticación' }, { status: 500 });
  }
}
