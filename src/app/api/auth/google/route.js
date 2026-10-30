import { NextResponse } from 'next/server';
import { upsertGoogleUser } from '@/lib/userRepository';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { credential } = await request.json();

    if (!credential) {
      return NextResponse.json({ error: 'Falta la credencial de Google' }, { status: 400 });
    }

    // Validar el ID token con Google OAuth2 tokeninfo (oficial y seguro sin librerías extras)
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    
    if (!googleRes.ok) {
      const errText = await googleRes.text();
      console.error('Google tokeninfo error:', errText);
      return NextResponse.json({ error: 'Token de Google inválido' }, { status: 401 });
    }

    const payload = await googleRes.json();

    // Validar aud (audience) coincidente
    const expectedAud = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "173592708065-1m316mss15guub2csg0f4jkhuoea0fct.apps.googleusercontent.com";
    if (expectedAud && payload.aud !== expectedAud) {
      return NextResponse.json({ error: 'Audience de Google inválido' }, { status: 403 });
    }

    const { sub: googleId, email, name, picture: avatar } = payload;

    // Guardar o actualizar en SQLite / Turso
    const result = await upsertGoogleUser({
      id: `google_${googleId}`,
      email,
      name,
      avatar,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        avatar: result.user.avatar,
      },
      settings: result.settings,
      token: result.token,
    });
  } catch (error) {
    console.error('Error en /api/auth/google:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
