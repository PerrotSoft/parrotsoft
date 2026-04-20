import { NextResponse } from 'next/server';
import * as actions from '@/app/actions';

async function verifyAccess(u, p) {
    if (!u || !p) return null;
    try {
        const driveData = await actions.getUserFiles(u);
        return driveData; 
    } catch (e) { return null; }
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const u = searchParams.get('user');
    const p = searchParams.get('pass'); 
    const cmd = searchParams.get('cmd');
    const args = searchParams.get('args') || "";
    
    if (!u || !p) return NextResponse.json({ error: "No credentials" }, { status: 401 });

    try {
        switch (cmd) {
            case 'disk_ls': return NextResponse.json(await actions.getDocs(u));
            case 'disk_files': return NextResponse.json(await actions.getUserFiles(u));
            case 'disk_add_proj': return NextResponse.json(await actions.addSearchItem(u, { name: args }));
            case 'disk_get_projs': return NextResponse.json(await actions.getProjects(u));
            case 'disk_sync_os': await actions.onSync(u, args); return NextResponse.json({ ok: true });
            case 'disk_search': 
                const d = await actions.getDocs(u);
                return NextResponse.json(d.filter(f => f.name?.includes(args)));
            case 'disk_clear_projs': await actions.syncProjects(u, []); return NextResponse.json({ ok: true });
            case 'disk_info': return NextResponse.json({ owner: u, database: "Turso/LibSQL" });
            case 'disk_global': return NextResponse.json(await actions.getGlobalSearchList());
            case 'disk_raw': return NextResponse.json(await actions.getUserFiles(u));
            case 'db_ls': 
                return NextResponse.json(await actions.pdb_list(u));
            case 'db_create': 
                return NextResponse.json(await actions.pdb_create(u, args));
            case 'db_delete_db': 
                return NextResponse.json(await actions.pdb_delete(u, args));
            case 'chat_init': return NextResponse.json(await actions.initDB());
            case 'chat_my': return NextResponse.json(await actions.getMyChats(u));
            case 'chat_search': return NextResponse.json(await actions.searchGlobal(args));
            case 'chat_get_msgs': return NextResponse.json(await actions.getMsgs(args));
            case 'chat_send': await actions.sendMsg(args.split(':')[0], u, args.split(':')[1]); return NextResponse.json({ ok: true });
            case 'chat_join': return NextResponse.json(await actions.joinChat(args, u));
            case 'chat_leave': return NextResponse.json(await actions.leaveChat(args, u));
            case 'chat_delete': return NextResponse.json(await actions.deleteChat(args));
            case 'chat_rename': return NextResponse.json(await actions.renameChat(args.split(':')[0], args.split(':')[1]));
            case 'chat_check_call': return NextResponse.json(await actions.checkActiveCall(args));
            case 'market_init': await actions.initParrotDB(); return NextResponse.json({ ok: true });
            case 'market_list': return NextResponse.json(await actions.getMarketItems(args));
            case 'market_balance': return NextResponse.json({ balance: await actions.getBalance(u) });
            case 'market_add_money': return NextResponse.json({ new_balance: await actions.addBalance(u, args) });
            case 'market_buy': return NextResponse.json(await actions.buyApp(args, u));
            case 'market_own': return NextResponse.json({ owned: await actions.checkOwnership(u, args) });
            case 'market_reviews': return NextResponse.json(await actions.getReviews(args));
            case 'market_manifest': return NextResponse.json(await actions.apiGetManifest(args));
            case 'market_resolve': return NextResponse.json(await actions.apiResolvePackage(args));
            case 'market_search_api': return NextResponse.json(await actions.apiSearchPacks(args));
            case 'tube_init': return NextResponse.json(await actions.setupSystemDatabases(u));
            case 'tube_all': return NextResponse.json(await actions.getVideos('all'));
            case 'tube_cat': return NextResponse.json(await actions.getVideos(args));
            case 'tube_backup': return NextResponse.json(await actions.generateFullBackup(u));
            case 'tube_search': 
                const v = await actions.getVideos('all');
                return NextResponse.json(v.filter(i => i.title.includes(args)));
            case 'tube_my':
                const allV = await actions.getVideos('all');
                return NextResponse.json(allV.filter(i => i.author === u));
            case 'tube_ban': return NextResponse.json(await actions.adminModifyUser(args, 'ban'));
            case 'tube_strike': return NextResponse.json(await actions.adminModifyUser(args, 'strike'));
            case 'sys_ping': return NextResponse.json({ pong: true, time: Date.now() });
            case 'sys_node': return NextResponse.json({ version: process.version });
            case 'sys_uptime': return NextResponse.json({ uptime: process.uptime() });

            default: return NextResponse.json({ error: "Command not found" }, { status: 404 });
        }
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}