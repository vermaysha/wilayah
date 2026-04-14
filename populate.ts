import { Database } from 'bun:sqlite';

type WilayahRow = {
  kode: string;
  nama: string;
};

type ParsedWilayah =
  | {
      level: 'provinsi';
      kode: string;
      nama: string;
    }
  | {
      level: 'kabupaten_kota';
      kode: string;
      nama: string;
      provinsiKode: string;
    }
  | {
      level: 'kecamatan';
      kode: string;
      nama: string;
      kabupatenKotaKode: string;
    }
  | {
      level: 'desa_kelurahan';
      kode: string;
      nama: string;
      kecamatanKode: string;
    };

const parseKemendagriKode = (kode: string, nama: string): ParsedWilayah | null => {
  if (!/^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/.test(kode)) {
    return null;
  }

  const parts = kode.split('.');

  if (parts.length === 1) {
    return { level: 'provinsi', kode, nama };
  }

  if (parts.length === 2) {
    return {
      level: 'kabupaten_kota',
      kode,
      nama,
      provinsiKode: parts[0] ?? '',
    };
  }

  if (parts.length === 3) {
    return {
      level: 'kecamatan',
      kode,
      nama,
      kabupatenKotaKode: `${parts[0] ?? ''}.${parts[1] ?? ''}`,
    };
  }

  if (parts.length === 4) {
    return {
      level: 'desa_kelurahan',
      kode,
      nama,
      kecamatanKode: `${parts[0] ?? ''}.${parts[1] ?? ''}.${parts[2] ?? ''}`,
    };
  }

  return null;
};

const setupPersistSchema = (db: Database) => {
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`CREATE TABLE IF NOT EXISTS provinsi (
    kode varchar(2) NOT NULL PRIMARY KEY,
    nama varchar(255) NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS kabupaten_kota (
    kode varchar(5) NOT NULL PRIMARY KEY,
    provinsi_kode varchar(2) NOT NULL,
    nama varchar(255) NOT NULL,
    FOREIGN KEY (provinsi_kode) REFERENCES provinsi(kode)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS kecamatan (
    kode varchar(8) NOT NULL PRIMARY KEY,
    kabupaten_kota_kode varchar(5) NOT NULL,
    nama varchar(255) NOT NULL,
    FOREIGN KEY (kabupaten_kota_kode) REFERENCES kabupaten_kota(kode)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS desa_kelurahan (
    kode varchar(13) NOT NULL PRIMARY KEY,
    kecamatan_kode varchar(8) NOT NULL,
    nama varchar(255) NOT NULL,
    FOREIGN KEY (kecamatan_kode) REFERENCES kecamatan(kode)
  );`);

  db.run('CREATE INDEX IF NOT EXISTS idx_kabupaten_kota_provinsi_kode ON kabupaten_kota(provinsi_kode);');
  db.run('CREATE INDEX IF NOT EXISTS idx_kecamatan_kabupaten_kota_kode ON kecamatan(kabupaten_kota_kode);');
  db.run('CREATE INDEX IF NOT EXISTS idx_desa_kelurahan_kecamatan_kode ON desa_kelurahan(kecamatan_kode);');
};

const populate = async () => {
  console.time('Fetch Data');
  const tempDb = new Database(':memory:');
  const persistDb = new Database('./wilayah.db');
  const data = await fetch('https://raw.githubusercontent.com/cahyadsn/wilayah/refs/heads/master/db/wilayah.sql');
  const sql = await data.text();
  console.timeEnd('Fetch Data');

  const startIndex = sql.indexOf('INSERT INTO');
  const insertStatements = sql.substring(startIndex).split(';').filter(statement => statement.trim() !== '');

  tempDb.run(`CREATE TABLE IF NOT EXISTS wilayah (
    kode varchar(255) NOT NULL PRIMARY KEY,
    nama varchar(255) NOT NULL
  );`);

  console.time('Insert Data');
  for (const statement of insertStatements) {
    tempDb.run(statement);
  }
  console.timeEnd('Insert Data');

  setupPersistSchema(persistDb);

  const rows = tempDb
    .query('SELECT kode, nama FROM wilayah ORDER BY kode')
    .all() as WilayahRow[];

  const insertProvinsi = persistDb.prepare('INSERT INTO provinsi (kode, nama) VALUES (?, ?)');
  const insertKabupatenKota = persistDb.prepare(
    'INSERT INTO kabupaten_kota (kode, provinsi_kode, nama) VALUES (?, ?, ?)',
  );
  const insertKecamatan = persistDb.prepare(
    'INSERT INTO kecamatan (kode, kabupaten_kota_kode, nama) VALUES (?, ?, ?)',
  );
  const insertDesaKelurahan = persistDb.prepare(
    'INSERT INTO desa_kelurahan (kode, kecamatan_kode, nama) VALUES (?, ?, ?)',
  );

  let skippedInvalid = 0;
  const summary = {
    provinsi: 0,
    kabupatenKota: 0,
    kecamatan: 0,
    desaKelurahan: 0,
  };

  console.time('Persist Parsed Data');
  persistDb.run('BEGIN TRANSACTION;');

  try {
    // Replace total: bersihkan data lama dulu (child -> parent)
    persistDb.run('DELETE FROM desa_kelurahan;');
    persistDb.run('DELETE FROM kecamatan;');
    persistDb.run('DELETE FROM kabupaten_kota;');
    persistDb.run('DELETE FROM provinsi;');

    for (const row of rows) {
      const parsed = parseKemendagriKode(row.kode, row.nama);

      if (!parsed) {
        skippedInvalid += 1;
        continue;
      }

      if (parsed.level === 'provinsi') {
        insertProvinsi.run(parsed.kode, parsed.nama);
        summary.provinsi += 1;
        continue;
      }

      if (parsed.level === 'kabupaten_kota') {
        insertKabupatenKota.run(parsed.kode, parsed.provinsiKode, parsed.nama);
        summary.kabupatenKota += 1;
        continue;
      }

      if (parsed.level === 'kecamatan') {
        insertKecamatan.run(parsed.kode, parsed.kabupatenKotaKode, parsed.nama);
        summary.kecamatan += 1;
        continue;
      }

      insertDesaKelurahan.run(parsed.kode, parsed.kecamatanKode, parsed.nama);
      summary.desaKelurahan += 1;
    }

    persistDb.run('COMMIT;');
  } catch (error) {
    persistDb.run('ROLLBACK;');
    throw error;
  } finally {
    console.timeEnd('Persist Parsed Data');
    tempDb.close();
    persistDb.close();
  }

  console.log('Import selesai. Ringkasan:');
  console.log(`- Provinsi: ${summary.provinsi}`);
  console.log(`- Kabupaten/Kota: ${summary.kabupatenKota}`);
  console.log(`- Kecamatan: ${summary.kecamatan}`);
  console.log(`- Desa/Kelurahan: ${summary.desaKelurahan}`);
  console.log(`- Kode invalid/skip: ${skippedInvalid}`);
}

populate();
