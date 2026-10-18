export function seedAnalyticsDemo(db) {
  if (db.prepare('SELECT name FROM schema_migrations WHERE name=?').get('analytics-v2')) return;
  db.exec('BEGIN');
  try {
    const campaigns = db.prepare("SELECT * FROM campaigns WHERE project_id='demo'").all();
    for (const c of campaigns) {
      for (let s = 0; s < 2; s++) {
        const sid = `${c.id}_set${s}`;
        db.prepare('INSERT OR IGNORE INTO ad_sets VALUES(?,?,?,?,?,?)').run(
          sid,
          c.id,
          null,
          s ? 'Remarketing · Engajados 7D' : 'Público aberto · Brasil',
          1,
          c.budget / 2,
        );
        for (let a = 0; a < 2; a++)
          db.prepare('INSERT OR IGNORE INTO ads VALUES(?,?,?,?,?)').run(
            `${sid}_ad${a}`,
            sid,
            null,
            a ? 'Vídeo · Demonstração do produto' : 'Imagem · Oferta principal',
            1,
          );
      }
      for (const row of db.prepare('SELECT * FROM spend WHERE campaign_id=?').all(c.id)) {
        const cents = Math.round(row.amount * 100);
        for (let n = 0; n < 4; n++)
          db.prepare('INSERT OR IGNORE INTO ad_insights VALUES(?,?,?,?,?)').run(
            `${c.id}_set${Math.floor(n / 2)}_ad${n % 2}`,
            row.day,
            (Math.floor(cents / 4) + (n === 3 ? cents % 4 : 0)) / 100,
            Math.floor(row.impressions / 4) + (n === 3 ? row.impressions % 4 : 0),
            Math.floor(row.clicks / 4) + (n === 3 ? row.clicks % 4 : 0),
          );
        const purchases = db
          .prepare(
            "SELECT COUNT(*) AS n FROM sales WHERE campaign_id=? AND day=? AND status='approved'",
          )
          .get(c.id, row.day).n;
        db.prepare('INSERT OR IGNORE INTO campaign_funnel VALUES(?,?,?,?,?,?)').run(
          c.id,
          row.day,
          row.clicks,
          Math.floor(row.clicks * 0.83),
          Math.floor(row.clicks * 0.15),
          purchases,
        );
      }
    }
    for (const sale of db.prepare("SELECT * FROM sales WHERE project_id='demo'").all()) {
      const match = /^s_(\d+)_(\d+)$/.exec(sale.id);
      if (!match) continue;
      const n = Number(match[2]),
        set = `${sale.campaign_id}_set${Math.floor((n % 4) / 2)}`;
      db.prepare('INSERT OR IGNORE INTO sale_attribution VALUES(?,?,?,?)').run(
        sale.id,
        `v_${match[1]}_${n}`,
        set,
        `${set}_ad${n % 2}`,
      );
    }
    for (const e of db
      .prepare("SELECT * FROM events WHERE project_id='demo' AND event_name='PageView'")
      .all()) {
      db.prepare('INSERT OR IGNORE INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
        e.id,
        `session_${e.visitor_id}`,
        'Página de vendas',
        null,
        null,
        null,
        'paid',
        null,
        null,
      );
      const index = Number(e.visitor_id.split('_').at(-1));
      if (index >= 80) continue;
      const type = index % 3 === 0 ? 'InitiateCheckout' : 'SectionView';
      const eid = `${e.id}_journey`;
      const time = new Date(Date.parse(e.created_at) + 90000).toISOString();
      db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
        eid,
        e.pixel_id,
        e.project_id,
        e.visitor_id,
        type,
        e.page_url,
        e.utm_source,
        e.utm_campaign,
        time,
        e.day,
      );
      db.prepare('INSERT OR IGNORE INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
        eid,
        `session_${e.visitor_id}`,
        'Página de vendas',
        null,
        type === 'SectionView' ? 'oferta' : null,
        type === 'InitiateCheckout' ? 'https://checkout.exemplo.com/' : null,
        'paid',
        null,
        null,
      );
    }
    db.prepare('INSERT INTO schema_migrations VALUES(?)').run('analytics-v2');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
