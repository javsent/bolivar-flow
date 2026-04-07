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

        let prevMes = mes - 1;
        let prevAnio = anio;
        if (prevMes === 0) { prevMes = 12; prevAnio -= 1; }

        // Trigger the endpoints based on the cron type
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        
        const urlObj = new URL(request.url, baseUrl);
        const sweepType = urlObj.searchParams.get('type') || 'daily';

        let promises = [fetch(`${baseUrl}/api/tasas`)];

        if (sweepType === 'sweep-current') {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${mes}&anio=${anio}&forceXlsx=true`));
        } else if (sweepType === 'sweep-previous') {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${prevMes}&anio=${prevAnio}&forceXlsx=true`));
        } else {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${mes}&anio=${anio}`));
        }

        await Promise.allSettled(promises);

        return NextResponse.json({ success: true, sweepType, message: 'Tasas sincronizadas exitosamente.' });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
