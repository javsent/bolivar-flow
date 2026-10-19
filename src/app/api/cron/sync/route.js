import { NextResponse } from 'next/server';
import { getVenezuelaDate } from '@/lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const now = getVenezuelaDate();
        const anio = now.getFullYear();
        const mes = now.getMonth() + 1;

        let prevMes = mes - 1;
        let prevAnio = anio;
        if (prevMes === 0) { prevMes = 12; prevAnio -= 1; }

        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        
        const urlObj = new URL(request.url, baseUrl);
        const sweepType = urlObj.searchParams.get('type') || 'daily';

        let promises = [fetch(`${baseUrl}/api/tasas`)];

        if (sweepType === 'sweep-current') {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${mes}&anio=${anio}`));
        } else if (sweepType === 'sweep-previous') {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${prevMes}&anio=${prevAnio}`));
        } else {
            promises.push(fetch(`${baseUrl}/api/historico?mes=${mes}&anio=${anio}`));
        }

        const results = await Promise.allSettled(promises);
        
        const summary = results.map((r, i) => {
            if (r.status === 'fulfilled') {
                return { endpoint: i === 0 ? 'tasas' : 'historico', status: r.value.status, ok: r.value.ok };
            }
            return { endpoint: i === 0 ? 'tasas' : 'historico', error: r.reason?.message || 'unknown' };
        });

        const allOk = results.every(r => r.status === 'fulfilled' && r.value.ok);

        console.log(`🔄 Cron sync [${sweepType}]: ${JSON.stringify(summary)}`);

        return NextResponse.json({ 
            success: allOk, 
            sweepType, 
            summary,
            message: allOk ? 'Tasas sincronizadas exitosamente.' : 'Sincronización parcial o fallida.'
        }, { status: allOk ? 200 : 207 });
    } catch (error) {
        console.error('❌ Error crítico en cron/sync:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
