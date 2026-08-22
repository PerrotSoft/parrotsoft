import { NextResponse } from 'next/server';
import { getMarketItems } from '@/app/actions';

// GET /api/market?q=search_term
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || "";
    
    try {
        const items = await getMarketItems(query);
        
        // Форматируем ответ специально для пакетного менеджера
        const packages = items.map(app => ({
            pkg: app.pkg_name,
            name: app.display_name,
            author: app.author,
            version_count: app.os_versions.length,
            price: app.price,
            type: app.type,
            rating: app.rating
        }));

        return NextResponse.json({ success: true, packages });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}