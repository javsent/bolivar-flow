import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const now = new Date();
        const anio = now.getFullYear();
        const mes = now.getMonth() + 1;

        // Trigger both endpoints locally to force them to run their sync logic
        // We use absolute URLs if VERCEL_URL is present, otherwise localhost (though this runs in Vercel)
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

        await Promise.allSettled([
            fetch(`${baseUrl}/api/tasas`),
            fetch(`${baseUrl}/api/historico?mes=${mes}&anio=${anio}&forceXlsx=true`)
        ]);

        return NextResponse.json({ success: true, message: 'Tasas sincronizadas exitosamente.' });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
