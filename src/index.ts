import db from '../wilayah.db' with { type: 'sqlite' };

type WilayahLevel = 'provinsi' | 'kabupaten_kota' | 'kecamatan' | 'desa_kelurahan';

type ApiError = {
	error: string;
};

const json = (data: unknown, status = 200) => {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
		},
	});
};

const badRequest = (message: string) => json({ error: message } satisfies ApiError, 400);
const notFound = (message = 'Endpoint tidak ditemukan') => json({ error: message } satisfies ApiError, 404);

const toInt = (value: string | null, fallback: number, min: number, max: number) => {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
};

const detectLevelFromKode = (kode: string): WilayahLevel | null => {
	if (/^\d{2}$/.test(kode)) return 'provinsi';
	if (/^\d{2}\.\d{2}$/.test(kode)) return 'kabupaten_kota';
	if (/^\d{2}\.\d{2}\.\d{2}$/.test(kode)) return 'kecamatan';
	if (/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(kode)) return 'desa_kelurahan';
	return null;
};

const server = Bun.serve({
	port: Number(Bun.env.PORT ?? 3000),
	fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		try {
			if (path === '/') {
				return json({
					message: 'API Wilayah Bun',
					endpoints: [
						'GET /api/provinsi',
						'GET /api/kabupaten-kota?provinsi_kode=11',
						'GET /api/kecamatan?kabupaten_kota_kode=11.01',
						'GET /api/desa-kelurahan?kecamatan_kode=11.01.01',
						'GET /api/alamat?kode=11.01.01.2001',
						'GET /api/search?q=aceh&limit=20',
					],
				});
			}

			if (path === '/api/provinsi') {
				const rows = db
					.query('SELECT kode, nama FROM provinsi ORDER BY kode')
					.all() as Array<{ kode: string; nama: string }>;
				return json({ total: rows.length, data: rows });
			}

			if (path === '/api/kabupaten-kota') {
				const provinsiKode = url.searchParams.get('provinsi_kode');

				if (!provinsiKode) {
					return badRequest('Parameter provinsi_kode wajib diisi, contoh: /api/kabupaten-kota?provinsi_kode=11');
				}

				const rows = db
					.query(
						`SELECT kk.kode, kk.nama, kk.provinsi_kode, p.nama AS provinsi_nama
						 FROM kabupaten_kota kk
						 JOIN provinsi p ON p.kode = kk.provinsi_kode
						 WHERE kk.provinsi_kode = ?
						 ORDER BY kk.kode`,
					)
					.all(provinsiKode) as Array<{ kode: string; nama: string; provinsi_kode: string; provinsi_nama: string }>;

				return json({ total: rows.length, data: rows });
			}

			if (path === '/api/kecamatan') {
				const kabupatenKotaKode = url.searchParams.get('kabupaten_kota_kode');

				if (!kabupatenKotaKode) {
					return badRequest(
						'Parameter kabupaten_kota_kode wajib diisi, contoh: /api/kecamatan?kabupaten_kota_kode=11.01',
					);
				}

				const rows = db
					.query(
						`SELECT kc.kode, kc.nama, kc.kabupaten_kota_kode,
										kk.nama AS kabupaten_kota_nama, p.kode AS provinsi_kode, p.nama AS provinsi_nama
						 FROM kecamatan kc
						 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
						 JOIN provinsi p ON p.kode = kk.provinsi_kode
						 WHERE kc.kabupaten_kota_kode = ?
						 ORDER BY kc.kode`,
					)
					.all(kabupatenKotaKode) as Array<{
					kode: string;
					nama: string;
					kabupaten_kota_kode: string;
					kabupaten_kota_nama: string;
					provinsi_kode: string;
					provinsi_nama: string;
				}>;

				return json({ total: rows.length, data: rows });
			}

			if (path === '/api/desa-kelurahan') {
				const kecamatanKode = url.searchParams.get('kecamatan_kode');

				if (!kecamatanKode) {
					return badRequest('Parameter kecamatan_kode wajib diisi, contoh: /api/desa-kelurahan?kecamatan_kode=11.01.01');
				}

				const rows = db
					.query(
						`SELECT dk.kode, dk.nama, dk.kecamatan_kode,
										kc.nama AS kecamatan_nama,
										kk.kode AS kabupaten_kota_kode, kk.nama AS kabupaten_kota_nama,
										p.kode AS provinsi_kode, p.nama AS provinsi_nama
						 FROM desa_kelurahan dk
						 JOIN kecamatan kc ON kc.kode = dk.kecamatan_kode
						 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
						 JOIN provinsi p ON p.kode = kk.provinsi_kode
						 WHERE dk.kecamatan_kode = ?
						 ORDER BY dk.kode`,
					)
					.all(kecamatanKode) as Array<{
					kode: string;
					nama: string;
					kecamatan_kode: string;
					kecamatan_nama: string;
					kabupaten_kota_kode: string;
					kabupaten_kota_nama: string;
					provinsi_kode: string;
					provinsi_nama: string;
				}>;

				return json({ total: rows.length, data: rows });
			}

			if (path === '/api/search') {
				const q = url.searchParams.get('q')?.trim() ?? '';
				const limit = toInt(url.searchParams.get('limit'), 20, 1, 100);

				if (q.length < 2) {
					return badRequest('Parameter q wajib diisi minimal 2 karakter, contoh: /api/search?q=aceh');
				}

				const keyword = `%${q}%`;

				const rows = db
					.query(
						`SELECT kode, nama, level, alamat_lengkap, parent_kode
						 FROM (
							 SELECT
								 kode,
								 nama,
								 'provinsi' AS level,
								 nama AS alamat_lengkap,
								 NULL AS parent_kode
							 FROM provinsi
							 WHERE nama LIKE ? OR kode LIKE ?

							 UNION ALL

							 SELECT
								 kk.kode,
								 kk.nama,
								 'kabupaten_kota' AS level,
								 p.nama || ', ' || kk.nama AS alamat_lengkap,
								 kk.provinsi_kode AS parent_kode
							 FROM kabupaten_kota kk
							 JOIN provinsi p ON p.kode = kk.provinsi_kode
							 WHERE kk.nama LIKE ? OR kk.kode LIKE ?

							 UNION ALL

							 SELECT
								 kc.kode,
								 kc.nama,
								 'kecamatan' AS level,
								 p.nama || ', ' || kk.nama || ', ' || kc.nama AS alamat_lengkap,
								 kc.kabupaten_kota_kode AS parent_kode
							 FROM kecamatan kc
							 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
							 JOIN provinsi p ON p.kode = kk.provinsi_kode
							 WHERE kc.nama LIKE ? OR kc.kode LIKE ?

							 UNION ALL

							 SELECT
								 dk.kode,
								 dk.nama,
								 'desa_kelurahan' AS level,
								 p.nama || ', ' || kk.nama || ', ' || kc.nama || ', ' || dk.nama AS alamat_lengkap,
								 dk.kecamatan_kode AS parent_kode
							 FROM desa_kelurahan dk
							 JOIN kecamatan kc ON kc.kode = dk.kecamatan_kode
							 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
							 JOIN provinsi p ON p.kode = kk.provinsi_kode
							 WHERE dk.nama LIKE ? OR dk.kode LIKE ?
						 )
						 ORDER BY kode
						 LIMIT ?`,
					)
					.all(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, limit) as Array<{
					kode: string;
					nama: string;
					level: WilayahLevel;
					alamat_lengkap: string;
					parent_kode: string | null;
				}>;

				return json({ q, limit, total: rows.length, data: rows });
			}

			if (path === '/api/alamat') {
				const kode = url.searchParams.get('kode')?.trim() ?? '';

				if (!kode) {
					return badRequest('Parameter kode wajib diisi, contoh: /api/alamat?kode=11.01.01.2001');
				}

				const level = detectLevelFromKode(kode);
				if (!level) {
					return badRequest('Format kode tidak valid');
				}

				if (level === 'provinsi') {
					const row = db.query('SELECT kode, nama FROM provinsi WHERE kode = ?').get(kode) as
						| { kode: string; nama: string }
						| null;
					if (!row) return json({ error: 'Kode tidak ditemukan' }, 404);
					return json({ level, kode: row.kode, nama: row.nama, alamat_lengkap: row.nama });
				}

				if (level === 'kabupaten_kota') {
					const row = db
						.query(
							`SELECT kk.kode, kk.nama, p.kode AS provinsi_kode, p.nama AS provinsi_nama
							 FROM kabupaten_kota kk
							 JOIN provinsi p ON p.kode = kk.provinsi_kode
							 WHERE kk.kode = ?`,
						)
						.get(kode) as
						| { kode: string; nama: string; provinsi_kode: string; provinsi_nama: string }
						| null;
					if (!row) return json({ error: 'Kode tidak ditemukan' }, 404);
					return json({
						level,
						kode: row.kode,
						nama: row.nama,
						provinsi: { kode: row.provinsi_kode, nama: row.provinsi_nama },
						alamat_lengkap: `${row.provinsi_nama}, ${row.nama}`,
					});
				}

				if (level === 'kecamatan') {
					const row = db
						.query(
							`SELECT kc.kode, kc.nama,
											kk.kode AS kabupaten_kota_kode, kk.nama AS kabupaten_kota_nama,
											p.kode AS provinsi_kode, p.nama AS provinsi_nama
							 FROM kecamatan kc
							 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
							 JOIN provinsi p ON p.kode = kk.provinsi_kode
							 WHERE kc.kode = ?`,
						)
						.get(kode) as
						| {
								kode: string;
								nama: string;
								kabupaten_kota_kode: string;
								kabupaten_kota_nama: string;
								provinsi_kode: string;
								provinsi_nama: string;
							}
						| null;
					if (!row) return json({ error: 'Kode tidak ditemukan' }, 404);

					return json({
						level,
						kode: row.kode,
						nama: row.nama,
						provinsi: { kode: row.provinsi_kode, nama: row.provinsi_nama },
						kabupaten_kota: { kode: row.kabupaten_kota_kode, nama: row.kabupaten_kota_nama },
						alamat_lengkap: `${row.provinsi_nama}, ${row.kabupaten_kota_nama}, ${row.nama}`,
					});
				}

				const row = db
					.query(
						`SELECT dk.kode, dk.nama,
										kc.kode AS kecamatan_kode, kc.nama AS kecamatan_nama,
										kk.kode AS kabupaten_kota_kode, kk.nama AS kabupaten_kota_nama,
										p.kode AS provinsi_kode, p.nama AS provinsi_nama
						 FROM desa_kelurahan dk
						 JOIN kecamatan kc ON kc.kode = dk.kecamatan_kode
						 JOIN kabupaten_kota kk ON kk.kode = kc.kabupaten_kota_kode
						 JOIN provinsi p ON p.kode = kk.provinsi_kode
						 WHERE dk.kode = ?`,
					)
					.get(kode) as
					| {
							kode: string;
							nama: string;
							kecamatan_kode: string;
							kecamatan_nama: string;
							kabupaten_kota_kode: string;
							kabupaten_kota_nama: string;
							provinsi_kode: string;
							provinsi_nama: string;
						}
					| null;

				if (!row) return json({ error: 'Kode tidak ditemukan' }, 404);

				return json({
					level,
					kode: row.kode,
					nama: row.nama,
					provinsi: { kode: row.provinsi_kode, nama: row.provinsi_nama },
					kabupaten_kota: { kode: row.kabupaten_kota_kode, nama: row.kabupaten_kota_nama },
					kecamatan: { kode: row.kecamatan_kode, nama: row.kecamatan_nama },
					alamat_lengkap: `${row.provinsi_nama}, ${row.kabupaten_kota_nama}, ${row.kecamatan_nama}, ${row.nama}`,
				});
			}

			return notFound();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Internal server error';
			return json({ error: message } satisfies ApiError, 500);
		}
	},
});

console.log(`API jalan di http://localhost:${server.port}`);
