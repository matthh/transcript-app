import { list } from '@vercel/blob';

async function main() {
  const blobs = await list({ prefix: 'cleanup-feedback/' });

  for (const b of blobs.blobs) {
    console.log(b.pathname, b.uploadedAt);
    const resp = await fetch(b.url, { cache: 'no-store' });
    const data = await resp.json();
    const accepted = data.decisions.filter((d: any) => d.accepted).length;
    const rejected = data.decisions.filter((d: any) => d.accepted === false).length;
    console.log(`  ${data.episodeName} — ${accepted} accepted, ${rejected} rejected`);

    const rejects = data.decisions.filter((d: any) => d.accepted === false);
    if (rejects.length > 0) {
      console.log('  REJECTED:');
      for (const r of rejects) {
        const c = r.change;
        console.log(`    [${c.type}] #${c.index} ${c.field}: "${c.oldValue?.slice(0, 60)}" → "${c.newValue?.slice(0, 60)}"`);
        console.log(`      reason: ${c.reason}`);
      }
    }

    const accepts = data.decisions.filter((d: any) => d.accepted);
    if (accepts.length > 0) {
      console.log('  ACCEPTED:');
      for (const a of accepts) {
        const c = a.change;
        console.log(`    [${c.type}] #${c.index} ${c.field}: "${c.oldValue?.slice(0, 60)}" → "${c.newValue?.slice(0, 60)}"`);
      }
    }
    console.log();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
