const SUPABASE_URL      = 'https://vwieuraqayzvgmjanzcz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3aWV1cmFxYXl6dmdtamFuemN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MDA1NzEsImV4cCI6MjA5ODQ3NjU3MX0.rbALQy5GShYDHw2S3BkQcQXwkEhWRmRwneew4DJuY5c';

// Public VAPID key for Web Push — safe to expose client-side (same idea as
// the anon key above; the matching PRIVATE key lives only as a Supabase
// Edge Function secret and is never sent to the browser).
const VAPID_PUBLIC_KEY  = 'BGPxpqJ4EE85VCaLLi5yLoGoipTTSYTI2k40hqqxgSFjIE4sGFf-MW1UzPqv-Wi06xoL4LWKy6yqfoU9P-s-e8k';

// ── SINGLE GLOBAL SUPABASE CLIENT ────────────────────────
// Created ONCE, before WRG and AUTH are defined below.
// Both sections call sb() to reuse this exact instance —
// prevents "multiple GoTrueClient instances" bugs and the
// null-client bug caused by referencing an undeclared _sbClient.
//
// global.fetch override: forces `cache: 'no-store'` on every request this
// client makes. Without this, a plain page refresh (F5) can return a
// browser-cached copy of a previous GET response (e.g. the verification
// status query) instead of hitting the network — so an admin's approval
// wouldn't show up until something forced a real reload (like logging in
// again). This guarantees every read is always live.
const _sbClient = (SUPABASE_URL !== 'YOUR_SUPABASE_URL')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) }
    })
  : null;
function sb() { return _sbClient; }

// ── SESSION DESYNC GUARD ─────────────────────────────────
// WRG keeps its own lightweight session copy in `wrg_session`,
// separate from Supabase's own auth storage (sb-<ref>-auth-token).
// If Supabase's cached refresh token ever goes stale (expired,
// already rotated, or left over from a previous login), the
// client auto-retries it on every page load and logs a 400 on
// /auth/v1/token?grant_type=refresh_token forever. This listener
// clears BOTH storages the moment Supabase reports the session
// as gone, so the two stay in sync and the app falls back to
// login.html cleanly instead of looping on a dead token.
function _clearSupabaseStorage() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) { /* localStorage unavailable, ignore */ }
}

if (_sbClient) {
  _sbClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
      _clearSupabaseStorage();
      try { localStorage.removeItem('wrg_session'); } catch (e) {}
    }
  });
}

const WRG = (() => {

  const USE_SUPABASE = SUPABASE_URL !== 'YOUR_SUPABASE_URL';

  const STORAGE_KEYS = {
    session:  'wrg_session',
    selected: 'wrg_selected_vehicle',
    booking:  'wrg_booking',
    bookings: 'wrg_bookings',
    tracking: 'wrg_tracking_unit',
    notifications: 'wrg_notifications',
    maintenance: 'wrg_maintenance',
    reviews: 'wrg_reviews',
    supportTickets: 'wrg_support_tickets'
  };

  const FLEET = [
    {
      id: 'apex-zero',
      name: 'PORSCHE 911 GT3',
      cls: 'Hyper Sport',
      img: 'https://images.unsplash.com/photo-1741345701055-b3e21f336bde?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 4000, rating: 4.9, battery: 92,
      tags: ['RWD', 'GPS Locked', 'Insured', 'Padyak Mode'],
      desc: 'Track-tuned 911 GT3 available for deployment in BGC and Makati. 0-100 in 3.2s, full telemetry, and PDK gearbox. The ultimate weapon on EDSA.'
    },
    {
      id: 'n-blade-elite',
      name: 'BMW M4 COMPETITION',
      cls: 'Tactical Coupe',
      img: 'https://images.unsplash.com/photo-1744223647422-da9a70f9aac8?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 3000, rating: 4.7, battery: 88,
      tags: ['RWD', 'Night Vision Cam', 'Insured', 'xDrive'],
      desc: 'M-Division coupe built for low-light city ops around Quezon City and Ortigas. Adaptive M suspension, carbon ceramic brakes, blackout trim.'
    },
    {
      id: 'titan-tactical',
      name: 'TOYOTA FORTUNER LTD',
      cls: 'Armored SUV',
      img: 'https://images.unsplash.com/photo-1664783856972-ac9922d7b2d3?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 1000, rating: 4.8, battery: 95,
      tags: ['4x4', '7-Seater', 'Insured', 'Diesel'],
      desc: 'The ultimate Pinas all-terrain commander. Off-road rated for Batangas and Tagaytay runs. Run-flat tires, command-grade interior, Manila flood mode.'
    },
    {
      id: 'vector-hub7',
      name: 'FORD RANGER RAPTOR',
      cls: 'Titanium Elite',
      img: 'https://images.unsplash.com/photo-1770096171604-2e6f19fc33c0?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 2000, rating: 4.6, battery: 81,
      tags: ['4x4', 'Cargo Mod', 'Insured', 'Fox Suspension'],
      desc: 'The Raptor. Bi-Turbo EcoBoost, Fox suspension, available from Clark and NLEX corridor pickup zones.'
    },
    // ── Motorcycle legacy fallbacks (passengerCapacity === '1-2') ──
    // Added because the previous legacy pool (above) was 100% cars/SUVs.
    // If a 1-2 passenger rider ever falls through both the narrow and
    // wide `vehicles` table queries (e.g. the motorcycle catalog isn't
    // seeded yet for a given use_case/tier), getRecommendation() must
    // still resolve to a motorcycle — never a car — for this capacity.
    {
      id: 'aerox-155-legacy',
      name: 'YAMAHA AEROX 155',
      cls: 'Performance Scooter',
      img: 'https://images.unsplash.com/photo-1517686469429-8bdb88b9f907?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 800, rating: 4.6, battery: 90,
      tags: ['Automatic', 'Insured', 'City Ready'],
      desc: 'Nimble performance scooter built for EDSA lane-splitting and quick city runs.'
    },
    {
      id: 'crf300l-legacy',
      name: 'HONDA CRF300L',
      cls: 'Off-road Performance',
      img: 'https://images.unsplash.com/photo-1591637333184-19aa84b3e01f?auto=format&fit=crop&w=800&q=80',
      ratePerDay: 1200, rating: 4.7, battery: 85,
      tags: ['Off-road', 'Insured', 'Dual Sport'],
      desc: 'Lightweight dual-sport built for Batangas trails and rough provincial roads.'
    }
  ];

  function read(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function normalizeVehicle(row) {
    return { id: row.slug, name: row.name, cls: row.class, img: row.img_url,
      ratePerDay: row.rate_per_day, rating: row.rating, battery: row.battery,
      tags: row.tags || [], desc: row.description, priceRange: row.price_range,
      vehicleType: row.vehicle_type || null };
  }

  /* ── REVIEW → RATING AGGREGATION ──────────────────────────────────────
     Turns raw review rows into per-vehicle {avg, count} stats. Used to
     make the star rating shown on fleet.html/vehicle cards reflect real
     rider feedback instead of the static seed value in FLEET/`vehicles`.
     A vehicle with zero reviews keeps its static seed rating (cold-start
     fallback) — see _attachRatingStats below. */
  function _reviewStatsByVehicle(reviews) {
    const map = {};
    (reviews || []).forEach(r => {
      const vid = r.vehicleId;
      if (!vid) return;
      if (!map[vid]) map[vid] = { sum: 0, count: 0 };
      map[vid].sum += Number(r.rating) || 0;
      map[vid].count += 1;
    });
    const out = {};
    Object.keys(map).forEach(vid => { out[vid] = { avg: map[vid].sum / map[vid].count, count: map[vid].count }; });
    return out;
  }

  // Merges computed review stats into a vehicle list. Vehicles with real
  // reviews get `rating` overwritten with the live average (rounded to 1
  // decimal) plus a `reviewCount`; vehicles with none keep their existing
  // (seed/static) rating and reviewCount: 0, so new listings never show a
  // scary 0★ before anyone has ridden them.
  function _attachRatingStats(list, stats) {
    return (list || []).map(v => {
      const s = stats[v.id];
      return s
        ? { ...v, rating: Math.round(s.avg * 10) / 10, reviewCount: s.count }
        : { ...v, reviewCount: 0 };
    });
  }

  // ── DECISION-TREE FLEET HELPERS ──────────────────────────────────────
  // Used by api.getRecommendation() below to query the real `vehicles`
  // table by use_case ('city'|'offroad'), tier ('cargo'|'budget'
  // |'luxury'|'performance'), and passenger_capacity ('3-4'|'5-7') —
  // there are two full 16-car catalogs seeded (one per passenger tier),
  // so capacity has to be filtered alongside use_case/tier or a 5-7
  // person rider could get matched against a 3-4 person car and vice
  // versa. Never throws — resolves to [] on any error so the caller can
  // fall back gracefully (see getRecommendation's fallback chain).
  function _fleetByUseCaseTier(useCase, tier, passengerCapacity) {
    if (!USE_SUPABASE) return Promise.resolve([]);
    let q = sb().from('vehicles').select('*').eq('use_case', useCase);
    if (tier) q = q.eq('tier', tier);
    if (passengerCapacity) q = q.eq('passenger_capacity', passengerCapacity);
    return q.order('rate_per_day', { ascending: true })
      .then(({ data, error }) => (error || !data) ? [] : data.map(normalizeVehicle))
      .catch(() => []);
  }

  // From a list of candidate vehicles (already narrowed to one use_case +
  // tier + passenger_capacity bucket), pick the best-rated one that fits
  // the rider's stated budget bucket.
  //
  // Primary rule: use the tier's own labeled `price_range` ('under_X' =
  // the lower band, 'X_Y' = the higher band) — that's the authoritative
  // source seeded straight from the pricing sheet, not a guess.
  //
  // Fallback (only if price_range is missing/inconsistent on some rows):
  // split the tier's own candidates by rate — RELATIVE to each other,
  // never against a fixed peso amount. Every tier has its own price band
  // (Cargo/Budget-Friendly, Luxury, Performance, etc. all sit at
  // different price levels), so a single hardcoded cutoff would
  // misclassify every car in the pricier tiers as "premium" and every
  // car in the cheaper tiers as "standard" — silently collapsing the
  // lower/higher choice into a no-op for those tiers.
  function _pickByBudget(list, isPremium) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];

    const labeled = list.filter(v => v.priceRange);
    if (labeled.length === list.length) {
      const matched = isPremium
        ? labeled.filter(v => !v.priceRange.startsWith('under_'))
        : labeled.filter(v => v.priceRange.startsWith('under_'));
      if (matched.length) {
        return matched.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
      }
    }

    const sorted = list.slice().sort((a, b) => a.ratePerDay - b.ratePerDay);
    const mid = Math.ceil(sorted.length / 2);
    const pool = isPremium ? sorted.slice(mid) : sorted.slice(0, mid);
    // Guard only for odd-length lists where one half could end up empty —
    // never triggered by the normal 2-per-tier case.
    const finalPool = pool.length ? pool : sorted;

    return finalPool.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
  }

  // ── VEHICLE TYPE CLASSIFICATION (car vs motorcycle) ──────────────────
  // The `vehicles` table/local fleet has no dedicated car/motorcycle
  // column today — only a free-text `cls` class label (e.g. "Off-road
  // Performance"), which is NOT reliable on its own: the Honda CRF300L is
  // a real motorcycle but its class label reads like an off-road SUV.
  // This checks the known legacy motorcycle IDs first (guaranteed
  // correct), then falls back to keyword matching across name/class/tags
  // for anything else (Supabase-seeded fleet, future additions).
  // NOTE: the keyword fallback is a heuristic — it will misclassify a
  // vehicle whose name/class/tags don't contain any of these terms. The
  // durable fix is a real `vehicle_type` column on the vehicles table;
  // this is the fast path until that migration is done.
  const _KNOWN_MOTORCYCLE_IDS = ['aerox-155-legacy', 'crf300l-legacy'];
  const _MOTORCYCLE_KEYWORDS = [
    'motorcycle', 'motorbike', 'scooter', 'moped', 'dual sport', 'dual-sport',
    'dirt bike', 'underbone', 'naked bike', 'adventure bike', 'sportbike',
    'sport bike', 'cruiser bike', 'e-bike', 'ebike',
    // Common named scooter/motorcycle models that may not carry a generic
    // "scooter"/"motorcycle" word in their class label (e.g. cls: "Maxi
    // Tourer" for an XMAX). Keeps classification correct even when the
    // DB's vehicle_type column hasn't been backfilled for that row yet.
    'xmax', 'nmax', 'click', 'beat', 'mio', 'wave', 'raider', 'barako',
    'skydrive', 'burgman', 'pcx', 'vespa', 'genio'
  ];

  function _isMotorcycle(vehicle) {
    if (!vehicle) return false;
    if (_KNOWN_MOTORCYCLE_IDS.includes(vehicle.id)) return true;
    const haystack = [vehicle.name, vehicle.cls, ...(vehicle.tags || [])].filter(Boolean).join(' ').toLowerCase();
    return _MOTORCYCLE_KEYWORDS.some(kw => haystack.includes(kw));
  }

  function _vehicleType(vehicle) {
    // Authoritative source: the real `vehicle_type` column (Supabase
    // `vehicles` table, backfilled via SQL migration — see
    // add-vehicle-type-column.sql). Only fall back to keyword-guessing
    // for vehicles that predate that column (local fallback pool, or
    // localStorage-mode entries with no Supabase row at all).
    if (vehicle && (vehicle.vehicleType === 'car' || vehicle.vehicleType === 'motorcycle')) {
      return vehicle.vehicleType;
    }
    return _isMotorcycle(vehicle) ? 'motorcycle' : 'car';
  }

  function _mockTrackingUnit() {
    let unit = read(STORAGE_KEYS.tracking);
    if (!unit) {
      unit = { unitId: 'WRG-UNIT-7421', driver: 'R. SANTOS', eta: '4 MIN', speed: 42, lat: 14.676, lng: 121.043, status: 'EN ROUTE', vehicleType: 'car' };
      write(STORAGE_KEYS.tracking, unit);
    }
    return unit;
  }

  // ── PER-VEHICLE TRACKING UNITS ───────────────────────────────────────
  // Every car in the fleet gets its own tracking unit: a unit ID derived
  // from that car's name, its own driver, and its own starting position —
  // instead of every vehicle sharing the single WRG-UNIT-7421 mock above.
  // Deterministic (hashed off the vehicle id) so the same car always
  // resolves to the same unit/driver/start point, then persisted to
  // localStorage per vehicle so its live position survives reloads.
  const _DRIVER_POOL = ['R. SANTOS', 'J. DELA CRUZ', 'M. REYES', 'A. BAUTISTA', 'K. MENDOZA', 'L. TORRES'];

  function _hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function _unitIdFromName(name) {
    const code = name.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().replace(/^-+|-+$/g, '');
    return 'WRG-' + code;
  }

  function _vehicleTrackingUnit(vehicle) {
    const key = STORAGE_KEYS.tracking + ':' + vehicle.id;
    let unit = read(key);
    if (!unit) {
      const h = _hashStr(vehicle.id);
      unit = {
        unitId: _unitIdFromName(vehicle.name),
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        vehicleType: _vehicleType(vehicle),
        driver: _DRIVER_POOL[h % _DRIVER_POOL.length],
        eta: (2 + (h % 8)) + ' MIN',
        speed: 25 + (h % 60),
        lat: 14.676 + (((h % 200) - 100) / 1000),
        lng: 121.043 + ((((h >> 3) % 200) - 100) / 1000),
        status: 'EN ROUTE'
      };
      write(key, unit);
    }
    return unit;
  }

  function _addLocalBooking(payload, session) {
    const list = read(STORAGE_KEYS.bookings, []);
    const now = new Date().toISOString();
    const booking = {
      ...payload,
      id: 'WRG-' + Math.floor(100000 + Math.random() * 899999),
      riderId: session ? session.id : null,
      status: 'pending',            // Reservation stage starts here
      reservationDate: now,
      createdAt: now
    };
    list.push(booking);
    write(STORAGE_KEYS.bookings, list);
    write(STORAGE_KEYS.booking, booking); // legacy single-booking pointer, kept for back-compat
    _logNotification('booking_submitted', {
      subject: 'Reservation Received — ' + booking.id,
      recipientId: booking.riderId,
      recipientName: booking.rider ? booking.rider.name : booking.riderName,
      recipientEmail: booking.rider ? booking.rider.email : null,
      relatedId: booking.id
    });
    return booking;
  }

  // Actual booking-creation logic, moved out of api.submitBooking() so the
  // verification hard-gate in api.submitBooking() always runs first — see
  // that function for why.
  function _submitBookingInner(payload) {
    if (USE_SUPABASE) {
      return api.getSession().then(session => {
        const row = {
          rider_id: session ? session.id : null,
          rider_name: payload.rider ? payload.rider.name : payload.riderName,
          rider_email: payload.rider ? payload.rider.email : null,
          vehicle_id: payload.vehicleId,
          vehicle_name: payload.vehicleName,
          days: payload.days,
          total: payload.total,
          status: 'pending',
          payment_method: payload.paymentMethod || null,
          payment_ref: payload.paymentRef || null,
          contract_signer_name: payload.contractSignerName || null,
          contract_signature: payload.contractSignature || null,
          contract_signed_at: payload.contractSignedAt || null
        };
        return sb().from('bookings').insert(row).select().single()
          .then(({ data, error }) => {
            if (error) throw error;
            // NOTE: id must stay the raw Supabase id (no 'WRG-' prefix) —
            // _rowToBooking() below returns the same raw id for every other
            // read path (getMyBookings, getAllBookings). A prefixed id here
            // would never match those lookups, breaking receipt.html and
            // any admin action that re-uses this id before a refetch.
            const booking = { ...payload, id: data.id, status: 'pending', reservationDate: data.created_at, createdAt: data.created_at };
            return booking;
          })
          .catch((err) => {
            console.error('submitBooking: Supabase insert failed, falling back to local:', err && err.message ? err.message : err, err);
            return _addLocalBooking(payload, session);
          });
      });
    }
    return api.getSession().then(session => _addLocalBooking(payload, session));
  }

  // Supabase columns are snake_case; the booking-lifecycle patches built
  // throughout this file (approvedAt, rejectionReason, odometerStart, …)
  // are camelCase. Convert before sending, so PostgREST doesn't reject
  // the whole UPDATE for referencing a column that doesn't exist.
  function _toSnakeCase(key) { return key.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); }

  // Reverse of _patchToRow: turns a raw Supabase bookings row (snake_case,
  // e.g. vehicle_id, rider_name, created_at) into the camelCase shape the
  // UI (admin.html, dashboard views) actually reads (vehicleId, riderName,
  // reservationDate). Without this, every b.vehicleId / b.reservationDate /
  // b.riderName lookup silently returns undefined and renders as "—".
  function _rowToBooking(row) {
    if (!row) return row;
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      riderId: row.rider_id,
      riderName: row.rider_name,
      rider: row.rider_name ? { name: row.rider_name, email: row.rider_email } : null,
      days: row.days,
      total: row.total,
      status: row.status,
      reservationDate: row.reservation_date || row.created_at,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      odometerStart: row.odometer_start,
      odometerEnd: row.odometer_end,
      fuelStart: row.fuel_start,
      fuelEnd: row.fuel_end,
      returnAt: row.return_at,
      contractSignerName: row.contract_signer_name,
      contractSignature: row.contract_signature,
      contractSignedAt: row.contract_signed_at,
      pickupAt: row.pickup_at,
      pickedUpAt: row.picked_up_at || row.pickup_at,
      paymentMethod: row.payment_method,
      paymentRef: row.payment_ref
    };
  }

  function _patchToRow(patch) {
    const row = {};
    Object.keys(patch).forEach(k => { row[_toSnakeCase(k)] = patch[k]; });
    return row;
  }

  // Shared by getRenterRiskProfile() (self) and getRiskProfileForUser()
  // (admin) — the Risk Signal node input for evaluateVerificationGate().
  // Soft signal only: feeds a FLAGGED verdict, never blocks by itself.
  function _riskFromBookings(list) {
    const cancelledCount = list.filter(b => b.status === 'cancelled').length;
    let lateReturnCount = 0;
    list.forEach(b => {
      if (b.status !== 'completed' || !b.days) return;
      const start = b.pickupAt || b.pickedUpAt;
      if (!start || !b.returnAt) return;
      const expected = new Date(new Date(start).getTime() + Number(b.days) * 86400000);
      if (new Date(b.returnAt) > expected) lateReturnCount++;
    });
    const incidents = cancelledCount + lateReturnCount;
    return { cancelledCount, lateReturnCount, incidents, flagged: incidents >= 2 };
  }

  function _transitionBooking(id, patch) {
    if (USE_SUPABASE && !String(id).startsWith('WRG-')) {
      return sb().from('bookings').update(_patchToRow(patch)).eq('id', id).select().single()
        .then(({ data, error }) => {
          if (error) throw error;         // was previously ignored — silent no-op bug
          return { ...data, ...patch };   // camelCase fields still available to callers
        })
        .catch((err) => {
          console.error('Booking transition failed, falling back to local:', err.message || err);
          return _transitionLocalBooking(id, patch);
        });
    }
    return Promise.resolve(_transitionLocalBooking(id, patch));
  }

  function _transitionLocalBooking(id, patch) {
    const list = read(STORAGE_KEYS.bookings, []);
    const idx = list.findIndex(b => b.id === id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...patch }; write(STORAGE_KEYS.bookings, list); }
    return list[idx] || null;
  }

  // ── VEHICLE AVAILABILITY ────────────────────────────────────────────────
  // Simple (non-date-aware) rule: a vehicle is "held" if any OTHER booking
  // for it is currently 'approved' (reserved, not yet picked up) or
  // 'ongoing' (out on rental). 'waitlist' bookings never count as holding
  // a vehicle — that's the whole point of the waitlist.
  function _vehicleHasActiveBooking(list, vehicleId, excludeId) {
    return (list || []).some(b =>
      b.vehicleId === vehicleId &&
      b.id !== excludeId &&
      (b.status === 'approved' || b.status === 'ongoing')
    );
  }

  // When a vehicle frees up (a booking completes, or an approved booking is
  // cancelled), auto-promote the oldest 'waitlist' booking for that same
  // vehicle to 'approved'. First-in-line, first served.
  function _promoteNextWaitlisted(vehicleId) {
    if (!vehicleId) return Promise.resolve(null);
    return api.getAllBookings().then(list => {
      const waiting = (list || [])
        .filter(b => b.vehicleId === vehicleId && b.status === 'waitlist')
        .sort((a, b) => new Date(a.createdAt || a.reservationDate || 0) - new Date(b.createdAt || b.reservationDate || 0));
      if (!waiting.length) return null;
      const next = waiting[0];
      return _transitionBooking(next.id, { status: 'approved', approvedAt: new Date().toISOString(), promotedFromWaitlist: true }).then(b => {
        if (b) _logNotification('booking_approved', {
          subject: 'Reservation Approved (promoted from Waitlist) — ' + b.id,
          recipientId: b.riderId,
          recipientName: b.rider?.name || b.riderName,
          recipientEmail: b.rider?.email,
          relatedId: b.id
        });
        return b;
      });
    });
  }

  // Email dispatch: every automated notification is logged locally (this
  // log IS the Email Notification Log Report data source) AND, when
  // Supabase is configured, fired off for real through the 'send-email'
  // Edge Function, which relays it to Brevo. The Brevo send is
  // fire-and-forget — if it fails (no network, bad key, etc.) the app
  // keeps working and the log entry is simply marked 'failed' instead of
  // 'sent', so a flaky send never breaks the booking/verification flow.
  function _logNotification(type, data) {
    const list = read(STORAGE_KEYS.notifications, []);
    const entry = {
      id: 'NTF-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      type,
      subject: data.subject || type,
      recipientId: data.recipientId || null,
      recipientName: data.recipientName || null,
      recipientEmail: data.recipientEmail || null,
      relatedId: data.relatedId || null,
      status: 'sent',
      sentAt: new Date().toISOString()
    };
    list.push(entry);
    write(STORAGE_KEYS.notifications, list);

    // Mirror the log into Supabase so it's shared across devices/browsers
    // instead of being stuck in this one browser's localStorage. Fire-and-forget:
    // if it fails (no table yet, RLS issue, offline), the localStorage copy above
    // already has it, so the Admin log for THIS browser still works either way.
    if (USE_SUPABASE) {
      sb().from('notifications').insert({
        id: entry.id,
        type: entry.type,
        subject: entry.subject,
        recipient_name: entry.recipientName,
        recipient_email: entry.recipientEmail,
        related_id: entry.relatedId,
        status: entry.status,
        sent_at: entry.sentAt
      }).then(({ error }) => {
        if (error) console.error('[notifications] Supabase insert failed:', error.message || error);
      });
    }

    if (USE_SUPABASE && entry.recipientEmail) {
      sb().functions.invoke('send-email', {
        body: {
          type,
          subject: entry.subject,
          recipientName: entry.recipientName,
          recipientEmail: entry.recipientEmail,
          relatedId: entry.relatedId
        }
      }).then(({ error }) => {
        if (error) {
          entry.status = 'failed';
          write(STORAGE_KEYS.notifications, read(STORAGE_KEYS.notifications, []).map(n => n.id === entry.id ? entry : n));
          console.error('[email] send-email failed for', type, error);
        }
      }).catch(err => console.error('[email] send-email invoke error', err));
    }

    // Push dispatch: separate from email above, keyed by recipientId (the
    // rider's auth uid) rather than email, since that's what the
    // push_subscriptions table is keyed on. Silently does nothing if the
    // rider never enabled push (send-push just returns sent:0) or if
    // recipientId wasn't passed by this call site yet.
    if (USE_SUPABASE && entry.recipientId) {
      sb().functions.invoke('send-push', {
        body: {
          recipientId: entry.recipientId,
          type,
          subject: entry.subject,
          relatedId: entry.relatedId
        }
      }).then(({ error }) => {
        if (error) console.error('[push] send-push failed for', type, error);
      }).catch(err => console.error('[push] send-push invoke error', err));
    }

    return entry;
  }

  // Converts the VAPID public key (base64url string) into the Uint8Array
  // format the Push API's subscribe() call expects.
  function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  const api = {

    // ── Push notifications ─────────────────────────────────────────────
    // Requests browser permission, subscribes this device via the
    // already-registered service worker, and saves the subscription to
    // Supabase so send-push (called from _logNotification above) can find
    // it later. Call from a user gesture (button click) — browsers block
    // Notification.requestPermission() if called on page load.
    enablePushNotifications() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return Promise.reject(new Error('Push notifications are not supported in this browser.'));
      }
      return api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('You must be logged in to enable notifications.'));
        return Notification.requestPermission().then(permission => {
          if (permission !== 'granted') return Promise.reject(new Error('Notification permission was not granted.'));
          return navigator.serviceWorker.ready.then(reg =>
            reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            })
          ).then(sub => {
            const json = sub.toJSON();
            if (!USE_SUPABASE) return true;
            return sb().from('push_subscriptions').upsert({
              rider_id: session.id,
              endpoint: json.endpoint,
              p256dh: json.keys.p256dh,
              auth_key: json.keys.auth
            }, { onConflict: 'rider_id,endpoint' }).then(({ error }) => {
              if (error) throw error;
              return true;
            });
          });
        });
      });
    },

    // Unsubscribes this device and removes its row from Supabase.
    disablePushNotifications() {
      if (!('serviceWorker' in navigator)) return Promise.resolve(true);
      return navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
        if (!sub) return true;
        const endpoint = sub.endpoint;
        return sub.unsubscribe().then(() => {
          if (!USE_SUPABASE) return true;
          return sb().from('push_subscriptions').delete().eq('endpoint', endpoint).then(() => true);
        });
      });
    },

    // Reports whether THIS device currently has an active push subscription
    // (not just whether the rider granted permission once).
    isPushEnabled() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return Promise.resolve(false);
      return navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => !!sub)
        .catch(() => false);
    },

    getFleet() {
      return api.getAllReviews().then(reviews => {
        const stats = _reviewStatsByVehicle(reviews);
        if (USE_SUPABASE) {
          return sb().from('vehicles').select('*').order('rate_per_day', { ascending: false })
            .then(({ data, error }) => {
              const list = (error || !data || !data.length) ? FLEET : data.map(normalizeVehicle);
              return _attachRatingStats(list, stats);
            })
            .catch(() => _attachRatingStats(FLEET, stats));
        }
        return _attachRatingStats(FLEET, stats);
      });
    },

    getVehicle(id) {
      return api.getAllReviews().then(reviews => {
        const stats = _reviewStatsByVehicle(reviews);
        const attachOne = v => v ? _attachRatingStats([v], stats)[0] : null;
        if (USE_SUPABASE) {
          return sb().from('vehicles').select('*').eq('slug', id).single()
            .then(({ data, error }) => attachOne(error || !data ? (FLEET.find(v => v.id === id) || null) : normalizeVehicle(data)))
            .catch(() => attachOne(FLEET.find(v => v.id === id) || null));
        }
        return attachOne(FLEET.find(v => v.id === id) || null);
      });
    },

    selectVehicle(id) {
      write(STORAGE_KEYS.selected, { vehicleId: id, ts: Date.now() });
      return Promise.resolve(true);
    },

    getSelectedVehicle() {
      const sel = read(STORAGE_KEYS.selected);
      if (!sel) return Promise.resolve(null);
      return api.getVehicle(sel.vehicleId);
    },

    /* ── BOOKING LIFECYCLE ─────────────────────────────────────────────
       Stage 1 (RESERVATION): pending → approved / waitlist / rejected / cancelled
       Stage 1b (QUEUE):      waitlist → approved (auto-promoted once the
                               vehicle frees up) / cancelled
       Stage 2 (TRANSACTION):  approved → ongoing (picked up) → completed
       'waitlist' exists because approval is gated on vehicle availability:
       if the vehicle a booking wants is already held by another
       'approved'/'ongoing' booking, approving it parks it on the waitlist
       instead of approving it outright. When the vehicle later frees up
       (markReturned or an approved-booking cancellation), the oldest
       waitlisted booking for that vehicle is auto-promoted to 'approved'.
       The Vehicle Reservation Report reads the whole list below (every
       booking passes through the reservation stage). The Rental
       Transaction Report reads only bookings that reached 'ongoing' or
       'completed' — i.e. the vehicle actually left the lot. */
    submitBooking(payload) {
      // Hard gate: re-check verification status here regardless of what the
      // calling page already checked (fleet.html's openAI() does this too,
      // but that's a UI convenience — this is the last line of defense so a
      // booking can never be created for an unverified/pending/rejected
      // rider, even via direct API call, disabled JS, or a stale page).
      return api.isRenterVerified().then(verified => {
        if (!verified) return Promise.reject(new Error('You must complete ID verification and be approved by an admin before renting a vehicle.'));
        return _submitBookingInner(payload);
      });
    },

    getBooking() {
      const list = read(STORAGE_KEYS.bookings, []);
      return Promise.resolve(list.length ? list[list.length - 1] : null);
    },

    clearBooking() {
      localStorage.removeItem(STORAGE_KEYS.booking);
      localStorage.removeItem(STORAGE_KEYS.bookings);
      localStorage.removeItem(STORAGE_KEYS.selected);
      return Promise.resolve(true);
    },

    /* getReceiptData() — assembles an automated digital receipt/invoice for

    /* getReceiptData() — assembles an automated digital receipt/invoice for
       a completed booking (Specific Objective #3). Renter-scoped: looks up
       the booking in the signed-in user's own history. */
    getReceiptData(bookingId) {
      // Look the booking up directly by its id rather than filtering the
      // current session's getMyBookings() list. getMyBookings() is
      // rider-scoped (it returns [] whenever there's no matching signed-in
      // session), so a receipt link opened without that exact session
      // active — e.g. a bare bookingId URL, a shared/printed link, or a
      // dev test URL — would silently fail to find the booking and every
      // field would fall back to its "—" / ₱0.00 placeholder. Fetching the
      // row straight by id works regardless of the active session; access
      // is still governed by the table's RLS policies.
      const findBooking = USE_SUPABASE
        ? sb().from('bookings').select('*').eq('id', bookingId).single()
            .then(({ data, error }) => (error || !data) ? null : _rowToBooking(data))
            .catch(() => null)
        : Promise.resolve((read(STORAGE_KEYS.bookings, []) || []).find(b => String(b.id) === String(bookingId)) || null);

      return Promise.all([findBooking, api.getFleet(), api.getSession()]).then(([booking, fleet, session]) => {
        if (!booking) return Promise.reject(new Error('Booking not found.'));
        const vehicle = (fleet || []).find(v => String(v.id) === String(booking.vehicleId)) || {};
        const rate = Number(vehicle.ratePerDay || vehicle.price) || 0;
        const days = Number(booking.days) || 1;
        const subtotal = booking.total != null ? Number(booking.total) : rate * days;
        const deposit = 5000; // standard security deposit hold, matches verification.html default
        return {
          receiptNo: 'WRG-RCPT-' + String(booking.id).replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase(),
          issuedAt: new Date().toISOString(),
          riderName: booking.riderName || (session && session.name) || '—',
          riderEmail: (booking.rider && booking.rider.email) || (session && session.email) || '—',
          vehicleName: vehicle.name || booking.vehicleName || 'Vehicle',
          vehicleType: vehicle.cls || '',
          days, ratePerDay: rate, subtotal, deposit, total: subtotal + deposit,
          status: booking.status, bookingId: booking.id,
          reservationDate: booking.reservationDate,
          paymentMethod: booking.paymentMethod || '—',
          paymentRef: booking.paymentRef || '—'
        };
      });
    },

    // Real (non-date-aware) availability check: a vehicle is available
    // unless it's currently held by an 'approved' or 'ongoing' booking.
    // A vehicle with no entry in the returned map is available (callers
    // should treat `map[id] !== false` as "bookable").
    //
    // IMPORTANT (Supabase mode): this must see active bookings across
    // ALL riders, not just the signed-in rider's own — but `bookings` is
    // RLS-gated to the rider's own rows for privacy (see getAllBookings
    // comments elsewhere). So in Supabase mode this calls the
    // get_vehicle_active_bookings() RPC instead (vehicle_id + status
    // only, no rider PII) — see vehicle-availability-function.sql for
    // the one-time DB setup this depends on. Falls back to
    // getAllBookings() in local/demo mode, or if that function isn't
    // set up yet.
    getVehicleAvailability() {
      function fromList(list) {
        const map = {};
        (list || []).forEach(b => {
          const vehicleId = b.vehicle_id || b.vehicleId;
          const status = b.status;
          if (vehicleId && (status === 'approved' || status === 'ongoing')) map[vehicleId] = false;
        });
        return map;
      }
      if (USE_SUPABASE) {
        return sb().rpc('get_vehicle_active_bookings')
          .then(({ data, error }) => {
            if (error || !data) return api.getAllBookings().then(fromList); // function missing/blocked — best-effort fallback
            return fromList(data);
          })
          .catch(() => api.getAllBookings().then(fromList));
      }
      return api.getAllBookings().then(fromList);
    },

    // Counts how many currently-AVAILABLE vehicles match a given filter
    // combination — used by recommend.html to lock out any Node 2
    // (terrain) or Node 3 (priority) option that would lead to zero
    // available vehicles, before the rider commits to that answer.
    // tier may be null to widen across all tiers (used for the terrain
    // node, since tier isn't chosen yet at that point).
    getAvailableCount(useCase, tier, passengerCapacity) {
      return Promise.all([
        _fleetByUseCaseTier(useCase, tier, passengerCapacity),
        api.getVehicleAvailability()
      ]).then(([candidates, availabilityMap]) => candidates.filter(v => availabilityMap[v.id] !== false).length);
    },

    // ── Report 1: Vehicle Reservation Report (every booking, pre- and post-approval)
    getReservations() { return api.getAllBookings(); },

    // ── Report 2: Rental Transaction Report (only bookings that reached pickup)
    getTransactions() {
      return api.getAllBookings().then(list => list.filter(b => b.status === 'ongoing' || b.status === 'completed'));
    },

    // Approving is gated on vehicle availability (see Image 2's "Car
    // Available?" node): if the requested vehicle is already held by
    // another approved/ongoing booking, this parks the booking on the
    // waitlist instead of approving it outright. The admin action is the
    // same either way ("Approve") — the system decides which of the two
    // outcomes actually applies.
    approveReservation(id) {
      return api.getAllBookings().then(list => {
        const booking = list.find(b => b.id === id);
        const vehicleId = booking && booking.vehicleId;
        const vehicleHeld = vehicleId ? _vehicleHasActiveBooking(list, vehicleId, id) : false;

        if (vehicleHeld) {
          return _transitionBooking(id, { status: 'waitlist', waitlistedAt: new Date().toISOString() }).then(b => {
            if (b) _logNotification('booking_waitlisted', {
              subject: 'Reservation Waitlisted (vehicle unavailable) — ' + b.id,
              recipientId: b.riderId,
              recipientName: b.rider?.name || b.riderName,
              recipientEmail: b.rider?.email,
              relatedId: b.id
            });
            return b;
          });
        }

        return _transitionBooking(id, { status: 'approved', approvedAt: new Date().toISOString() }).then(b => {
          if (b) _logNotification('booking_approved', { subject: 'Reservation Approved — ' + b.id, recipientId: b.riderId, recipientName: b.rider?.name || b.riderName, recipientEmail: b.rider?.email, relatedId: b.id });
          return b;
        });
      });
    },
    rejectReservation(id, reason) {
      return _transitionBooking(id, { status: 'rejected', rejectedAt: new Date().toISOString(), rejectionReason: reason || null }).then(b => {
        if (b) _logNotification('booking_rejected', { subject: 'Reservation Rejected — ' + b.id, recipientId: b.riderId, recipientName: b.rider?.name || b.riderName, recipientEmail: b.rider?.email, relatedId: b.id });
        return b;
      });
    },
    markPickedUp(id) {
      return _transitionBooking(id, { status: 'ongoing', pickupAt: new Date().toISOString() }).then(b => {
        if (b) _logNotification('booking_pickup', { subject: 'Vehicle Picked Up — ' + b.id, recipientId: b.riderId, recipientName: b.rider?.name || b.riderName, recipientEmail: b.rider?.email, relatedId: b.id });
        return b;
      });
    },
    markReturned(id, meta) {
      return _transitionBooking(id, {
        status: 'completed', returnAt: new Date().toISOString(),
        odometerStart: meta && meta.odometerStart, odometerEnd: meta && meta.odometerEnd,
        fuelStart: meta && meta.fuelStart, fuelEnd: meta && meta.fuelEnd
      }).then(b => {
        if (b) _logNotification('booking_returned', { subject: 'Vehicle Returned — ' + b.id, recipientId: b.riderId, recipientName: b.rider?.name || b.riderName, recipientEmail: b.rider?.email, relatedId: b.id });
        // Vehicle just freed up — bump the next waitlisted booking (if any).
        return _promoteNextWaitlisted(b && b.vehicleId).then(() => b);
      });
    },

    // ── RENTER-SIDE CANCELLATION ─────────────────────────────────────────
    // Only allowed before the vehicle actually leaves the lot (pending,
    // approved, or waitlisted). Once it's 'ongoing' or 'completed' the
    // rider can no longer self-cancel — that has to go through support
    // instead. Cancelling an 'approved' booking frees the vehicle it was
    // holding, so we auto-promote the next waitlisted booking for it;
    // cancelling a 'pending' or 'waitlist' booking never held the vehicle,
    // so nothing needs to be promoted.
    cancelReservation(id, currentStatus) {
      if (!['pending', 'approved', 'waitlist'].includes(currentStatus)) {
        return Promise.reject(new Error('This booking can no longer be cancelled — please contact support.'));
      }
      return api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('You must be logged in to cancel a booking.'));
        return _transitionBooking(id, { status: 'cancelled', cancelledAt: new Date().toISOString() }).then(b => {
          if (b) _logNotification('booking_cancelled', {
            subject: 'Reservation Cancelled — ' + (b.id || id),
            recipientId: b.riderId || session.id,
            recipientName: (b.rider && b.rider.name) || b.riderName || session.name,
            recipientEmail: (b.rider && b.rider.email) || b.riderEmail || session.email,
            relatedId: b.id || id
          });
          if (currentStatus === 'approved') {
            return _promoteNextWaitlisted(b && b.vehicleId).then(() => b);
          }
          return b;
        });
      });
    },

    // Pass a vehicle id (e.g. from fleet.html's Track button, or the
    // ?vehicle= query param on tracking.html) to track THAT car specifically.
    // With no id, falls back to whatever vehicle is currently selected, then
    // to the first fleet car — so old callers keep working unchanged.
    // If the logged-in rider has an active rental (approved/ongoing) on this
    // exact car, the tracked "driver" becomes THEM — their registered name
    // from account/registration replaces the placeholder pool name. Nobody
    // else's name is exposed; only your own active booking counts.
    getTrackingUnit(vehicleId) {
      const applyRenterName = (unit, vehicle) => api.getSession().then(session => {
        if (!session) return unit;
        return api.getMyBookings().then(bookings => {
          const mine = bookings.find(b => b.vehicleId === vehicle.id && (b.status === 'approved' || b.status === 'ongoing'));
          if (mine && session.name) return { ...unit, driver: session.name, isRenter: true };
          return unit;
        });
      });

      // ── ADMIN-ASSIGNED RIDER AS DRIVER ─────────────────────────────────
      // Users → Rider Registry lets an admin pin a rider to a vehicle
      // (profiles.assigned_vehicle, see assignVehicleToRider() below). If
      // nobody is actively renting the car right now (applyRenterName
      // above already wins that case via isRenter), fall back to that
      // assigned rider's name instead of the generic pool/placeholder
      // name so the Tracking Hub shows a real, admin-designated driver.
      const applyAssignedRider = (unit, vehicle) => {
        if (unit.isRenter) return unit;
        return api.getAllUsers().then(users => {
          const assigned = (users || []).find(u =>
            u.assigned_vehicle != null &&
            String(u.assigned_vehicle) === String(vehicle.id) &&
            String(u.role || '').toLowerCase() === 'rider'
          );
          if (assigned && (assigned.name || assigned.email)) {
            return { ...unit, driver: assigned.name || assigned.email, isAssignedRider: true };
          }
          return unit;
        }).catch(() => unit);
      };

      const resolveFor = (vid) => api.getVehicle(vid).then(vehicle => {
        if (!vehicle) return _mockTrackingUnit();
        if (USE_SUPABASE) {
          return sb().from('tracking').select('*').eq('vehicle_id', vehicle.id).eq('status', 'active').limit(1).single()
            .then(({ data, error }) => {
              const base = (error || !data)
                ? _vehicleTrackingUnit(vehicle)
                : { unitId: data.unit_id, vehicleId: vehicle.id, vehicleName: vehicle.name, vehicleType: _vehicleType(vehicle), driver: data.driver_name, eta: data.eta, speed: data.speed, lat: data.lat, lng: data.lng, status: data.status.toUpperCase(), updatedAt: data.updated_at };
              return applyRenterName(base, vehicle).then(u => applyAssignedRider(u, vehicle));
            });
        }
        return Promise.resolve(_vehicleTrackingUnit(vehicle))
          .then(unit => applyRenterName(unit, vehicle))
          .then(u => applyAssignedRider(u, vehicle));
      });

      if (vehicleId) return resolveFor(vehicleId);
      return api.getSelectedVehicle().then(v => resolveFor(v ? v.id : (FLEET[0] && FLEET[0].id)));
    },

    // ── LIVE GPS PUSH ──────────────────────────────────────────────────
    // Called from the driver/renter's own phone browser (via
    // navigator.geolocation.watchPosition) to push REAL coordinates into
    // the `tracking` table. Upserts on vehicle_id so each car keeps
    // exactly one "live" row that gets overwritten every few seconds
    // instead of piling up a new row per ping.
    //
    // ⚠ Requires a UNIQUE constraint on tracking.vehicle_id in Supabase.
    // If it's not there yet, run once in the SQL editor:
    //   ALTER TABLE tracking ADD CONSTRAINT tracking_vehicle_id_key UNIQUE (vehicle_id);
    updateTrackingPosition(vehicleId, { lat, lng, speed, unitId, driverName, status } = {}) {
      if (!vehicleId || typeof lat !== 'number' || typeof lng !== 'number') {
        return Promise.reject(new Error('vehicleId, lat, and lng are required.'));
      }
      if (!USE_SUPABASE) {
        // Local-storage fallback so the driver-share UI still works in demo mode.
        const key = STORAGE_KEYS.tracking + ':' + vehicleId;
        const existing = read(key) || {};
        const updated = { ...existing, vehicleId, lat, lng, speed: speed ?? existing.speed ?? 0, status: status || 'EN ROUTE' };
        write(key, updated);
        return Promise.resolve(updated);
      }
      return api.getSession().then(session => {
        const row = {
          vehicle_id: vehicleId,
          lat, lng,
          speed: speed ?? 0,
          status: status || 'active',
          driver_name: driverName || (session && session.name) || 'Driver',
          unit_id: unitId || _unitIdFromName(String(vehicleId)),
          updated_at: new Date().toISOString()
        };
        return sb().from('tracking').upsert(row, { onConflict: 'vehicle_id' }).select().single()
          .then(({ data, error }) => { if (error) throw error; return data; });
      });
    },

    /* ── DECISION TREE RECOMMENDATION ENGINE ──────────────────────────
       A rule-based (ID3-style) decision tree over four rider-supplied
       attributes: passengers, terrain, priority, budget.
       Each branch decision is recorded in `path` so the UI (and the
       thesis' "Recommendation Effectiveness Report") can show exactly
       which nodes were traversed to reach the leaf (vehicle) node. */
    getRecommendation(answers) {
      const { passengers, terrain, priority, budget } = answers;
      const path = [];

      // Node 1: Passenger count → which of the two 16-car catalogs to search.
      // Previously "5-7" short-circuited straight to a hardcoded Fortuner,
      // skipping Terrain/Priority/Budget entirely. Now it just picks the
      // catalog (passenger_capacity) and the rider still walks the full tree.
      const passengerCapacity = passengers === '5-7' ? '5-7' : (passengers === '1-2' ? '1-2' : '3-4');
      path.push({
        node: 'Passenger Count',
        test: passengers === '1-2' ? '1–2 passengers' : (passengers === '5-7' ? '5–7 passengers' : '3–4 passengers'),
        result: passengers === '5-7'
          ? 'Requires 7-seater capacity — narrowed to the 5–7 person fleet'
          : passengers === '1-2'
            ? 'Motorcycle-only — narrowed to the 1–2 person fleet'
            : 'Within seating capacity — proceed to Terrain node'
      });

      // Node 2: Terrain → use_case
      const useCase = terrain === 'offroad' ? 'offroad' : 'city';
      path.push({
        node: 'Terrain',
        test: terrain === 'offroad' ? 'Off-road / rough terrain' : 'City / Highway',
        result: `Fleet narrowed to use_case = "${useCase}"`
      });

      // Node 3: Priority → tier
      // practicality → cargo, budget → budget, luxury → luxury, speed → performance
      const TIER_BY_PRIORITY = { speed: 'performance', luxury: 'luxury', practicality: 'cargo', budget: 'budget' };
      const PRIORITY_LABEL   = { speed: 'Speed & Performance', luxury: 'Luxury & Comfort', practicality: 'Practicality & Cargo', budget: 'Budget-Friendly' };
      const tier = TIER_BY_PRIORITY[priority] || 'budget';
      path.push({
        node: 'Priority',
        test: PRIORITY_LABEL[priority] || 'Budget-Friendly',
        result: `Fleet narrowed to tier = "${tier}"`
      });

      // Node 4: Budget → pick best-rated unit within the stated daily-rate range,
      // relative to the other candidates in this tier (see _pickByBudget).
      const isPremium = budget === 'premium';
      path.push({
        node: 'Budget',
        test: isPremium ? 'Higher-Priced Option' : 'Lower-Priced Option',
        result: `Selecting best-rated unit in the ${isPremium ? 'pricier' : 'cheaper'} half of this tier`
      });

      return Promise.all([
        _fleetByUseCaseTier(useCase, tier, passengerCapacity),
        api.getVehicleAvailability()
      ]).then(([rawCandidates, availabilityMap]) => {
        // Never recommend a unit that's currently held by an
        // approved/ongoing booking — an unavailable id simply isn't in
        // availabilityMap's "true" set (it defaults available if the
        // map has no entry for it, e.g. a brand-new vehicle).
        const candidates = rawCandidates.filter(v => availabilityMap[v.id] !== false);
        let vehicle = _pickByBudget(candidates, isPremium);
        if (vehicle) {
          path.push({ node: 'Result', test: `${useCase} / ${tier} / ${passengerCapacity} / ${isPremium ? 'premium' : 'standard'}`, result: `${vehicle.name} selected` });
          return { vehicle, path, answers };
        }
        // No seeded vehicle for this exact use_case + tier + capacity combo — widen to the whole use_case + capacity bucket.
        return _fleetByUseCaseTier(useCase, null, passengerCapacity).then(widerRaw => {
          const wider = widerRaw.filter(v => availabilityMap[v.id] !== false);
          vehicle = _pickByBudget(wider, isPremium);
          if (vehicle) {
            path.push({ node: 'Fallback', test: `No "${tier}" unit tagged for ${useCase} (${passengerCapacity} person)`, result: `${vehicle.name} selected as nearest match` });
            return { vehicle, path, answers };
          }
          // Last resort — legacy hardcoded picks so the quiz never dead-ends
          // even if the vehicles table is empty or unreachable.
          // IMPORTANT: this must never cross vehicle-type boundaries — a
          // 1-2 passenger (motorcycle-only) rider must always land on a
          // motorcycle here, never one of the car/SUV legacy picks below.
          const legacyId = passengerCapacity === '1-2'
            ? (useCase === 'offroad' ? 'crf300l-legacy' : 'aerox-155-legacy')
            : (useCase === 'offroad' || priority === 'practicality') ? 'vector-hub7' : 'titan-tactical';
          path.push({ node: 'Fallback', test: 'No matching unit in database fleet', result: 'Using legacy fleet pick' });
          return api.getVehicle(legacyId).then(v => ({ vehicle: v, path, answers }));
        });
      });
    },

    logRecommendation(entry) {
      const row = { ...entry, ts: new Date().toISOString(), accepted: false };
      if (USE_SUPABASE) {
        return api.getSession().then(session => {
          return sb().from('recommendations').insert({
            rider_id: session ? session.id : null,
            answers: entry.answers,
            recommended_vehicle_id: entry.vehicleId,
            path: entry.path,
            accepted: false
          }).select().single().then(({ data, error }) => {
            if (error) { // table may not exist yet — fall back silently
              const list = read('wrg_recommendations', []);
              list.push({ ...row, id: 'REC-' + Date.now() });
              write('wrg_recommendations', list);
              return row;
            }
            return { ...row, id: data.id };
          });
        }).catch(() => {
          const list = read('wrg_recommendations', []);
          const saved = { ...row, id: 'REC-' + Date.now() };
          list.push(saved);
          write('wrg_recommendations', list);
          return saved;
        });
      }
      const list = read('wrg_recommendations', []);
      const saved = { ...row, id: 'REC-' + Date.now() };
      list.push(saved);
      write('wrg_recommendations', list);
      return Promise.resolve(saved);
    },

    markRecommendationAccepted(recId) {
      if (!recId) return Promise.resolve(false);
      if (USE_SUPABASE && !String(recId).startsWith('REC-')) {
        return sb().from('recommendations').update({ accepted: true }).eq('id', recId).then(() => true).catch(() => false);
      }
      const list = read('wrg_recommendations', []);
      const idx = list.findIndex(r => r.id === recId);
      if (idx >= 0) { list[idx].accepted = true; write('wrg_recommendations', list); }
      return Promise.resolve(true);
    },

    getRecommendationLog() {
      if (USE_SUPABASE) {
        return sb().from('recommendations').select('*').order('created_at', { ascending: false })
          .then(({ data, error }) => error ? read('wrg_recommendations', []) : data)
          .catch(() => read('wrg_recommendations', []));
      }
      return Promise.resolve(read('wrg_recommendations', []));
    },

    /* ── RENTER VERIFICATION (ID / Clearance Upload + Admin Approval) ──
       Screening documents are compressed to small base64 thumbnails by
       the calling page (see verification.html) before being passed in,
       to keep them well under localStorage / row size limits.

       evaluateVerificationGate() is a small decision-tree-style gate that
       runs BEFORE a submission reaches an admin. It walks a fixed sequence
       of yes/no checks over the renter's inputs and returns both the final
       verdict and the node-by-node path taken to reach it — the same
       pattern used by getRecommendation() for the vehicle-match quiz.
       This does not replace admin judgment (an admin can still reject an
       otherwise-complete submission); it only screens out incomplete
       submissions before they reach the review queue. */
    /* evaluateVerificationGate() — the AI-based Decision Tree from Specific
       Objective #2 of the thesis paper. Walks 6 sequential nodes over the
       renter's credentials/background and returns a verdict of
       APPROVED-track ('READY_FOR_REVIEW'), 'FLAGGED' (marked for closer
       review), or 'REJECTED' pre-check ('INCOMPLETE'), plus a 0-100 score
       and the full node-by-node decision path (rendered live in
       verification.html and fleet.html). Age/License/Documents/Agreement/
       Deposit are hard gates — any failure blocks submission outright.
       Risk Signal (prior cancellations / late returns, from the renter's
       own booking history) is a soft gate — it can only downgrade an
       otherwise-clean pass to FLAGGED, never block it by itself, so a
       single admin-facing AI check can never be the sole reason a renter
       is locked out. Final approval authority still rests with the admin
       (see reviewVerification) — this tree pre-classifies, it doesn't
       replace human sign-off. */
    evaluateVerificationGate(input) {
      const has = (v) => !!v;
      const path = [];
      let verdict = 'READY_FOR_REVIEW';
      let blockedAt = null;
      let score = 0;
      const POINTS = { age: 20, license: 20, docs: 20, agreement: 20, deposit: 20 };

      // Node 1: Age — minimum 21 y/o, standard PH self-drive rental age
      let age = null;
      if (input.birthdate) {
        const dob = new Date(input.birthdate);
        if (!isNaN(dob.getTime())) {
          const now = new Date();
          age = now.getFullYear() - dob.getFullYear();
          if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
        }
      }
      if (age === null) {
        path.push({ node: 'Age Check', test: 'Renter is 21 years or older?', result: 'MISSING date of birth' });
        verdict = 'INCOMPLETE'; blockedAt = 'age';
      } else if (age < 21) {
        path.push({ node: 'Age Check', test: 'Renter is 21 years or older?', result: 'FAILED — applicant is ' + age });
        verdict = 'INCOMPLETE'; blockedAt = 'age';
      } else {
        path.push({ node: 'Age Check', test: 'Renter is 21 years or older?', result: 'Passed — applicant is ' + age });
        score += POINTS.age;
      }

      // Node 2: License
      if (!has(input.license)) {
        path.push({ node: 'License Check', test: "Driver's License uploaded?", result: 'MISSING Driver\u2019s License' });
        verdict = 'INCOMPLETE'; blockedAt = blockedAt || 'license';
      } else {
        path.push({ node: 'License Check', test: "Driver's License uploaded?", result: 'License document present' });
        score += POINTS.license;
      }

      // Node 3: remaining required documents
      const docNames = { govId: 'Government ID', residency: 'Proof of Residency', clearance: 'Police/NBI Clearance' };
      const missingDocs = Object.keys(docNames).filter(k => !has(input[k]));
      if (missingDocs.length) {
        path.push({ node: 'Document Check', test: '3 remaining required documents uploaded?', result: 'MISSING: ' + missingDocs.map(k => docNames[k]).join(', ') });
        verdict = 'INCOMPLETE'; blockedAt = blockedAt || 'documents';
      } else {
        path.push({ node: 'Document Check', test: '3 remaining required documents uploaded?', result: 'All required documents present' });
        score += POINTS.docs;
      }

      // Node 4: rental agreement
      if (!input.agreementAccepted) {
        path.push({ node: 'Agreement Check', test: 'Digital Rental Agreement accepted?', result: 'NOT ACCEPTED — cannot proceed' });
        verdict = 'INCOMPLETE'; blockedAt = blockedAt || 'agreement';
      } else {
        path.push({ node: 'Agreement Check', test: 'Digital Rental Agreement accepted?', result: 'Accepted' });
        score += POINTS.agreement;
      }

      // Node 5: security deposit
      if (!input.depositAmount || input.depositAmount <= 0) {
        path.push({ node: 'Deposit Check', test: 'Security deposit amount set?', result: 'MISSING deposit amount' });
        verdict = 'INCOMPLETE'; blockedAt = blockedAt || 'deposit';
      } else {
        path.push({ node: 'Deposit Check', test: 'Security deposit amount set?', result: '\u20b1' + Number(input.depositAmount).toLocaleString('en-PH') + ' authorized' });
        score += POINTS.deposit;
      }

      // Node 6: Risk Signal — prior cancelled / late-return bookings.
      // Soft gate: only evaluated (and only able to FLAG, never block)
      // once every hard node above has passed.
      const risk = input.risk || { cancelledCount: 0, lateReturnCount: 0, incidents: 0, flagged: false };
      if (verdict !== 'INCOMPLETE') {
        if (risk.flagged) {
          path.push({ node: 'Risk Signal', test: 'Prior cancellations / late returns?', result: 'FLAGGED — ' + risk.cancelledCount + ' cancelled, ' + risk.lateReturnCount + ' late return(s)' });
          verdict = 'FLAGGED';
        } else {
          path.push({ node: 'Risk Signal', test: 'Prior cancellations / late returns?', result: risk.incidents ? risk.incidents + ' minor incident(s) — within tolerance' : 'No prior incidents on record' });
        }
        path.push({ node: 'Gate Result', test: 'All checks evaluated', result: verdict === 'FLAGGED' ? 'FLAGGED FOR ADMIN REVIEW' : 'READY FOR ADMIN REVIEW' });
      }

      return { verdict, blockedAt, path, score, age, risk };
    },

    /* getRenterRiskProfile() — pulls the signed-in renter's own booking
       history and reduces it to the Risk Signal node's input. A soft
       signal by design: it can only escalate an otherwise-clean gate
       pass to FLAGGED for closer admin review, never block on its own. */
    getRenterRiskProfile() {
      return api.getMyBookings().then(bookings => _riskFromBookings(bookings || []));
    },

    /* Admin-only variant — same Risk Signal calculation, scoped to any
       renter's bookings by userId. Used by admin.html's verification
       review modal so the re-evaluated gate reflects that renter's real
       risk history instead of defaulting to zero. Relies on
       getAllBookings() already being admin-gated by Supabase RLS. */
    getRiskProfileForUser(userId) {
      return api.getAllBookings().then(all => _riskFromBookings((all || []).filter(b => b.riderId === userId)));
    },

    submitVerification(payload) {
      return api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('You must be logged in to submit verification.'));
        return api.getRenterRiskProfile().then(risk => {
          const gate = api.evaluateVerificationGate({ ...payload, risk });
          if (gate.verdict === 'INCOMPLETE') {
            const err = new Error('Submission blocked at: ' + gate.blockedAt);
            err.gate = gate;
            return Promise.reject(err);
          }
          const row = {
            userId: session.id, userName: session.name, userEmail: session.email,
            govId: payload.govId || null,
            license: payload.license || null,
            residency: payload.residency || null,
            clearance: payload.clearance || null,
            birthdate: payload.birthdate || null,
            agreementAccepted: !!payload.agreementAccepted,
            depositAmount: payload.depositAmount || 5000,
            status: 'pending',
            gateVerdict: gate.verdict,
            score: gate.score,
            riskFlag: gate.verdict === 'FLAGGED',
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewNote: null
          };
          const result = USE_SUPABASE
            ? sb().from('verifications').upsert({
                rider_id: session.id, rider_name: session.name, rider_email: session.email,
                gov_id: row.govId, license_doc: row.license, residency_doc: row.residency, clearance_doc: row.clearance,
                birthdate: row.birthdate, agreement_accepted: row.agreementAccepted, deposit_amount: row.depositAmount,
                status: 'pending', gate_verdict: row.gateVerdict, score: row.score, risk_flag: row.riskFlag
              }, { onConflict: 'rider_id' }).select().single()
                .then(({ data, error }) => {
                  if (error) throw error;
                  return { ...row, id: data.id };
                })
                .catch(() => _saveLocalVerification(row))
            : Promise.resolve(_saveLocalVerification(row));

          return result.then(saved => {
            _logNotification('verification_submitted', {
              subject: 'Verification Received — ' + session.name,
              recipientId: session.id, recipientName: session.name, recipientEmail: session.email, relatedId: saved.id
            });
            return { ...saved, gate };
          });
        });
      });
    },

    getMyVerification() {
      return api.getSession().then(session => {
        if (!session) return null;
        if (USE_SUPABASE) {
          return sb().from('verifications').select('*').eq('rider_id', session.id).maybeSingle()
            .then(({ data, error }) => (error || !data) ? _readLocalVerification(session.id) : _normalizeVerificationRow(data))
            .catch(() => _readLocalVerification(session.id));
        }
        return _readLocalVerification(session.id);
      });
    },

    getAllVerifications() {
      if (USE_SUPABASE) {
        return sb().from('verifications').select('*').order('submitted_at', { ascending: false })
          .then(({ data, error }) => error ? read('wrg_verifications', []) : data.map(_normalizeVerificationRow))
          .catch(() => read('wrg_verifications', []));
      }
      return Promise.resolve(read('wrg_verifications', []));
    },

    reviewVerification(id, decision, note) {
      const status = decision === 'approve' ? 'approved' : 'rejected';
      const finish = (record) => {
        if (record) {
          _logNotification(status === 'approved' ? 'verification_approved' : 'verification_rejected', {
            subject: (status === 'approved' ? 'Verification Approved — ' : 'Verification Rejected — ') + (record.userName || ''),
            recipientId: record.userId, recipientName: record.userName, recipientEmail: record.userEmail, relatedId: record.id
          });
        }
        return record;
      };
      if (USE_SUPABASE && !String(id).startsWith('VER-')) {
        return sb().from('verifications').update({ status, review_note: note || null, reviewed_at: new Date().toISOString() }).eq('id', id).select().single()
          .then(({ data }) => finish(data && _normalizeVerificationRow(data)))
          .catch(() => finish(_reviewLocalVerification(id, status, note)));
      }
      return Promise.resolve(finish(_reviewLocalVerification(id, status, note)));
    },

    /* ── REVIEWS / TESTIMONIALS ────────────────────────────────────────
       One review per completed booking. Written to the Supabase `reviews`
       table when available (falls back to localStorage `wrg_reviews`,
       same pattern as verifications/bookings above). Rider testimonials
       on the homepage are populated from getFeaturedReviews(). */
    submitReview({ bookingId, vehicleId, vehicleName, rating, comment }) {
      return api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('You must be logged in to leave a review.'));
        const stars = Math.round(Number(rating) || 0);
        if (stars < 1 || stars > 5) return Promise.reject(new Error('Please select a star rating.'));
        const row = {
          bookingId: String(bookingId), riderId: session.id, riderName: session.name,
          riderEmail: session.email, vehicleId: vehicleId || null, vehicleName: vehicleName || null,
          rating: stars, comment: (comment || '').trim().slice(0, 600),
          createdAt: new Date().toISOString(), operatorReply: null, repliedAt: null
        };

        const result = USE_SUPABASE
          ? sb().from('reviews').upsert({
              booking_id: row.bookingId, rider_id: row.riderId, rider_name: row.riderName,
              rider_email: row.riderEmail, vehicle_id: row.vehicleId, vehicle_name: row.vehicleName,
              rating: row.rating, comment: row.comment
            }, { onConflict: 'booking_id' }).select().single()
            .then(({ data, error }) => {
              if (error) throw error;
              return { ...row, id: data.id };
            })
            .catch(() => _saveLocalReview(row))
          : Promise.resolve(_saveLocalReview(row));

        return result.then(saved => {
          _logNotification('review_submitted', {
            subject: 'New Review — ' + (saved.vehicleName || 'Vehicle') + ' (' + saved.rating + '★)',
            recipientId: saved.riderId, recipientName: saved.riderName, recipientEmail: saved.riderEmail, relatedId: saved.id
          });
          return saved;
        });
      });
    },

    // Reviews the current rider has already left — used to hide the
    // "Leave a Review" prompt on bookings that already have one.
    getMyReviews() {
      return api.getSession().then(session => {
        if (!session) return [];
        if (USE_SUPABASE) {
          return sb().from('reviews').select('*').eq('rider_id', session.id)
            .then(({ data, error }) => error ? read(STORAGE_KEYS.reviews, []).filter(r => r.riderId === session.id) : data.map(_normalizeReviewRow))
            .catch(() => read(STORAGE_KEYS.reviews, []).filter(r => r.riderId === session.id));
        }
        return Promise.resolve(read(STORAGE_KEYS.reviews, []).filter(r => r.riderId === session.id));
      });
    },

    // Public reviews for the homepage "Rider Testimonials" section —
    // most recent first, capped at `limit`.
    getFeaturedReviews(limit = 6) {
      if (USE_SUPABASE) {
        return sb().from('reviews').select('*').order('created_at', { ascending: false }).limit(limit)
          .then(({ data, error }) => error || !data ? read(STORAGE_KEYS.reviews, []).slice(-limit).reverse() : data.map(_normalizeReviewRow))
          .catch(() => read(STORAGE_KEYS.reviews, []).slice(-limit).reverse());
      }
      return Promise.resolve(read(STORAGE_KEYS.reviews, []).slice(-limit).reverse());
    },

    // Admin-scoped: every review, newest first, including ones with no
    // operator reply yet — used by the admin Reviews tab.
    getAllReviews() {
      if (USE_SUPABASE) {
        return sb().from('reviews').select('*').order('created_at', { ascending: false })
          .then(({ data, error }) => error || !data ? read(STORAGE_KEYS.reviews, []).slice().reverse() : data.map(_normalizeReviewRow))
          .catch(() => read(STORAGE_KEYS.reviews, []).slice().reverse());
      }
      return Promise.resolve(read(STORAGE_KEYS.reviews, []).slice().reverse());
    },

    /* ── ADMIN REVIEW ANALYTICS ───────────────────────────────────────────
       These two power the "studies feedback... for service quality
       improvement and more informed decision making" side of the review
       system (objective #5) — getAllReviews()/renderReviews() already
       cover gather + show; these cover study. */

    // Per-vehicle breakdown: average rating + review count for every
    // vehicle in the fleet, sorted worst-rated first (vehicles with no
    // reviews yet sort last) so admins can spot which units are hurting
    // service quality at a glance.
    getVehicleReviewStats() {
      return Promise.all([api.getAllReviews(), api.getFleet()]).then(([reviews, fleet]) => {
        const stats = _reviewStatsByVehicle(reviews);
        return fleet.map(v => {
          const s = stats[v.id];
          return {
            vehicleId: v.id, vehicleName: v.name,
            avgRating: s ? Math.round(s.avg * 10) / 10 : null,
            reviewCount: s ? s.count : 0
          };
        }).sort((a, b) => {
          if (a.avgRating === null && b.avgRating === null) return 0;
          if (a.avgRating === null) return 1;
          if (b.avgRating === null) return -1;
          return a.avgRating - b.avgRating;
        });
      });
    },

    // Fleet-wide insight summary: monthly average-rating trend (for
    // spotting service quality drifting up/down over time), 1-5 star
    // distribution, and a count of low (<=2★) reviews needing attention.
    getReviewInsights(months = 6) {
      return api.getAllReviews().then(reviews => {
        const now = new Date();
        const buckets = [];
        for (let i = months - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          buckets.push({ label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth(), sum: 0, count: 0 });
        }
        reviews.forEach(r => {
          if (!r.createdAt) return;
          const d = new Date(r.createdAt);
          const b = buckets.find(x => x.year === d.getFullYear() && x.month === d.getMonth());
          if (b) { b.sum += Number(r.rating) || 0; b.count += 1; }
        });
        const trend = buckets.map(b => ({ label: b.label, avgRating: b.count ? Math.round((b.sum / b.count) * 10) / 10 : null, count: b.count }));
        const totalReviews = reviews.length;
        const overallAvg = totalReviews ? Math.round((reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / totalReviews) * 10) / 10 : null;
        const lowRatingCount = reviews.filter(r => Number(r.rating) <= 2).length;
        const distribution = [5, 4, 3, 2, 1].map(star => ({ star, count: reviews.filter(r => Math.round(Number(r.rating)) === star).length }));
        return { trend, totalReviews, overallAvg, lowRatingCount, distribution };
      });
    },

    // Operator reply to a rider review. One reply per review — resubmitting
    // overwrites the previous reply, same "last write wins" behavior as
    // reviewVerification(). Fires a notification to the reviewing rider.
    respondToReview(id, replyText) {
      const reply = (replyText || '').trim().slice(0, 600);
      if (!reply) return Promise.reject(new Error('Reply cannot be empty.'));
      const finish = (record) => {
        if (record) {
          _logNotification('review_response', {
            subject: 'WheelRentraGo replied to your review',
            recipientId: record.riderId, recipientName: record.riderName, recipientEmail: record.riderEmail, relatedId: record.id
          });
        }
        return record;
      };
      if (USE_SUPABASE && !String(id).startsWith('REV-')) {
        return sb().from('reviews').update({ operator_reply: reply, replied_at: new Date().toISOString() }).eq('id', id).select().single()
          .then(({ data }) => finish(data && _normalizeReviewRow(data)))
          .catch(() => finish(_respondLocalReview(id, reply)));
      }
      return Promise.resolve(finish(_respondLocalReview(id, reply)));
    },

    /* ── SUPPORT TICKETS ─────────────────────────────────────────────
       Backs the "Contact Protocol" form on support.html. No login
       required — writes to the Supabase `support_tickets` table when
       available (falls back to localStorage `wrg_support_tickets`,
       same pattern as reviews/verifications above). Attaches riderId
       automatically if the sender happens to be logged in, so admins
       can cross-reference the account without requiring it. */
    submitSupportTicket({ name, email, category, message }) {
      const cleanName = (name || '').trim().slice(0, 120);
      const cleanEmail = (email || '').trim().slice(0, 200);
      const cleanMsg = (message || '').trim().slice(0, 2000);
      if (!cleanName || !cleanEmail || !cleanMsg) {
        return Promise.reject(new Error('Please fill in your name, email, and message.'));
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return Promise.reject(new Error('Please enter a valid email address.'));
      }
      return api.getSession().then(session => {
        const row = {
          riderId: session ? session.id : null,
          name: cleanName, email: cleanEmail,
          category: category || 'General Inquiry', message: cleanMsg,
          status: 'open', createdAt: new Date().toISOString()
        };
        if (USE_SUPABASE) {
          return sb().from('support_tickets').insert({
              rider_id: row.riderId, name: row.name, email: row.email,
              category: row.category, message: row.message, status: row.status
            }).select().single()
            .then(({ data, error }) => {
              if (error) throw error;
              return { ...row, id: data.id };
            })
            .catch(error => {
              // Surface the real reason the write failed (RLS policy, missing
              // table, column mismatch, etc.) instead of failing silently.
              // The rider still gets a working "sent" experience via the
              // localStorage fallback, but this ticket will NOT be visible
              // to admin until the underlying Supabase issue is fixed.
              console.error('[WRG] support_tickets insert failed — ticket saved locally only, admin will NOT see it:', error);
              return _saveLocalSupportTicket(row);
            });
        }
        return Promise.resolve(_saveLocalSupportTicket(row));
      });
    },

    // Admin-only: full ticket list, most recent first.
    getAllSupportTickets() {
      if (USE_SUPABASE) {
        return sb().from('support_tickets').select('*').order('created_at', { ascending: false })
          .then(({ data, error }) => {
            if (error || !data) {
              console.error('[WRG] support_tickets fetch failed — showing this admin\'s local fallback tickets only:', error);
              return read(STORAGE_KEYS.supportTickets, []).slice().reverse();
            }
            return data.map(_normalizeSupportTicketRow);
          })
          .catch(error => {
            console.error('[WRG] support_tickets fetch threw — showing this admin\'s local fallback tickets only:', error);
            return read(STORAGE_KEYS.supportTickets, []).slice().reverse();
          });
      }
      return Promise.resolve(read(STORAGE_KEYS.supportTickets, []).slice().reverse());
    },

    // Admin-only: mark a ticket in_progress / resolved, optionally with a note.
    updateSupportTicket(id, { status, adminNote }) {
      const patch = {};
      if (status) patch.status = status;
      if (adminNote !== undefined) patch.admin_note = adminNote;
      if (status === 'resolved') patch.resolved_at = new Date().toISOString();
      if (USE_SUPABASE) {
        return sb().from('support_tickets').update(patch).eq('id', id).select().single()
          .then(({ data, error }) => { if (error) throw error; return _normalizeSupportTicketRow(data); });
      }
      const list = read(STORAGE_KEYS.supportTickets, []);
      const idx = list.findIndex(t => String(t.id) === String(id));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...(status ? { status } : {}), ...(adminNote !== undefined ? { adminNote } : {}),
          ...(status === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}) };
        write(STORAGE_KEYS.supportTickets, list);
        return Promise.resolve(list[idx]);
      }
      return Promise.reject(new Error('Ticket not found.'));
    },

    isRenterVerified() {
      return api.getMyVerification().then(v => !!(v && v.status === 'approved'));
    },

    /* ── Report 3: Vehicle Utilization Report ──────────────────────────
       "Days Rented" and revenue are counted only for transactions whose
       pickup falls inside the selected period; idle days fill the rest
       of the period. */
    getVehicleUtilization(periodDays) {
      const days = periodDays || 30;
      const since = new Date(Date.now() - days * 86400000);
      return Promise.all([api.getFleet(), api.getTransactions()]).then(([fleet, transactions]) => {
        const list = fleet.map(v => {
          const vTx = transactions.filter(b => b.vehicleId === v.id);
          const inPeriod = vTx.filter(b => {
            const d = b.pickupAt ? new Date(b.pickupAt) : (b.reservationDate ? new Date(b.reservationDate) : null);
            return d && d >= since;
          });
          const bookingsCount = inPeriod.length;
          const daysRented = inPeriod.reduce((s, b) => s + (Number(b.days) || 0), 0);
          const idleDays = Math.max(0, days - daysRented);
          const utilizationRate = days > 0 ? Math.round(Math.min(100, (daysRented / days) * 100) * 10) / 10 : 0;
          const revenue = inPeriod.reduce((s, b) => s + (b.total || 0), 0);
          const currentlyOut = vTx.some(b => b.status === 'ongoing');
          return { vehicleId: v.id, vehicleName: v.name, vehicleClass: v.cls, bookingsCount, daysRented, idleDays, utilizationRate, revenue, currentlyOut };
        });
        list.sort((a, b) => b.utilizationRate - a.utilizationRate);
        return list;
      });
    },

    /* ── Report 4: Maintenance Schedule Report ──────────────────────────
       No physical odometer/service sensor exists in this demo, so each
       vehicle gets a seeded "last service date" the first time it's
       queried (deterministic per vehicle, so the demo is reproducible),
       then follows a fixed 90-day service interval from there on. */
    getMaintenanceSchedule() {
      const SERVICE_INTERVAL_DAYS = 90;
      const DUE_SOON_WINDOW_DAYS = 14;
      return api.getFleet().then(fleet => {
        const now = Date.now();
        return fleet.map(v => {
          const rec = _getMaintenanceRecord(v.id);
          const lastServiceDate = rec.lastServiceDate;
          const nextDueDate = new Date(new Date(lastServiceDate).getTime() + SERVICE_INTERVAL_DAYS * 86400000).toISOString();
          const daysUntilDue = (new Date(nextDueDate).getTime() - now) / 86400000;
          let status = 'ok';
          if (daysUntilDue < 0) status = 'overdue';
          else if (daysUntilDue <= DUE_SOON_WINDOW_DAYS) status = 'due_soon';
          return { id: v.id, vehicleId: v.id, vehicleName: v.name, label: 'General Service (Oil, Filters, Brake Check)', lastServiceDate, nextDueDate, status };
        }).sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
      });
    },

    logMaintenanceService(vehicleId, note) {
      const list = read(STORAGE_KEYS.maintenance, []);
      const idx = list.findIndex(m => m.vehicleId === vehicleId);
      const now = new Date().toISOString();
      if (idx >= 0) {
        list[idx].history = list[idx].history || [];
        list[idx].history.push({ date: now, note: note || '' });
        list[idx].lastServiceDate = now;
      } else {
        list.push({ vehicleId, lastServiceDate: now, history: [{ date: now, note: note || '' }] });
      }
      write(STORAGE_KEYS.maintenance, list);
      return Promise.resolve(true);
    },

    /* ── Report 5: Revenue and Profit Report ─────────────────────────────
       Operating cost is estimated as a fixed 35% of revenue (fuel,
       insurance, and amortized maintenance) — a standard simplification
       for a capstone-scope system that doesn't track itemized expenses. */
    getRevenueReport(periodDays) {
      const days = periodDays || 30;
      const since = new Date(Date.now() - days * 86400000);
      const COST_RATIO = 0.35;
      return Promise.all([api.getFleet(), api.getTransactions()]).then(([fleet, transactions]) => {
        const inPeriod = transactions.filter(b => {
          const d = b.returnAt ? new Date(b.returnAt) : (b.pickupAt ? new Date(b.pickupAt) : null);
          return d && d >= since;
        });
        const grossRevenue = inPeriod.reduce((s, b) => s + (b.total || 0), 0);
        const estimatedCost = Math.round(grossRevenue * COST_RATIO);
        const netProfit = grossRevenue - estimatedCost;
        const profitMargin = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 1000) / 10 : 0;

        const byVehicle = fleet.map(v => {
          const vTx = inPeriod.filter(b => b.vehicleId === v.id);
          const revenue = vTx.reduce((s, b) => s + (b.total || 0), 0);
          const cost = Math.round(revenue * COST_RATIO);
          const profit = revenue - cost;
          const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
          return { vehicleId: v.id, vehicleName: v.name, vehicleClass: v.cls, bookingsCount: vTx.length, revenue, cost, profit, margin };
        }).filter(v => v.bookingsCount > 0).sort((a, b) => b.revenue - a.revenue);

        const byDate = {};
        inPeriod.forEach(b => {
          const dateKey = (b.returnAt || b.pickupAt).slice(0, 10);
          byDate[dateKey] = (byDate[dateKey] || 0) + (b.total || 0);
        });
        const trend = Object.keys(byDate).sort().map(date => {
          const revenue = byDate[date];
          const cost = Math.round(revenue * COST_RATIO);
          return { date, revenue, cost, profit: revenue - cost };
        });

        return { grossRevenue, estimatedCost, netProfit, profitMargin, byVehicle, trend };
      });
    },

    /* ── Report 6: Customer Rental History Report ────────────────────── */
    getCustomerRentalHistory() {
      return Promise.all([api.getAllUsers(), api.getAllBookings(), api.getAllVerifications()]).then(([users, bookings, verifications]) => {
        return users.map(u => {
          const mine = bookings.filter(b => b.riderId === u.id || (b.rider && b.rider.email === u.email));
          const completed = mine.filter(b => b.status === 'completed');
          const totalSpent = completed.reduce((s, b) => s + (b.total || 0), 0);
          const avgSpend = completed.length ? Math.round(totalSpent / completed.length) : 0;
          const verif = verifications.find(v => v.userId === u.id);
          const lastRentalDate = mine.length ? mine.map(b => b.reservationDate).filter(Boolean).sort().slice(-1)[0] : null;
          return {
            userId: u.id, name: u.name, email: u.email,
            totalRentals: mine.length, completedRentals: completed.length,
            totalSpent, avgSpend,
            verificationStatus: verif ? verif.status : 'unverified',
            lastRentalDate
          };
        }).sort((a, b) => b.totalSpent - a.totalSpent);
      });
    },

    /* ── Report 7: Recommendation Effectiveness Report ───────────────── */
    getRecommendationEffectiveness() {
      return Promise.all([api.getRecommendationLog(), api.getFleet()]).then(([log, fleet]) => {
        const total = log.length;
        const accepted = log.filter(r => r.accepted).length;
        const acceptanceRate = total ? Math.round((accepted / total) * 1000) / 10 : 0;
        const nameFor = (id) => { const v = fleet.find(f => f.id === id); return v ? v.name : (id || 'Unknown'); };

        const vMap = {};
        log.forEach(r => {
          const key = r.vehicleId || 'unknown';
          if (!vMap[key]) vMap[key] = { vehicleName: nameFor(key), recommended: 0, accepted: 0 };
          vMap[key].recommended++;
          if (r.accepted) vMap[key].accepted++;
        });
        const byVehicle = Object.values(vMap)
          .map(v => ({ ...v, acceptanceRate: v.recommended ? Math.round((v.accepted / v.recommended) * 1000) / 10 : 0 }))
          .sort((a, b) => b.recommended - a.recommended);

        const pMap = {};
        log.forEach(r => {
          const key = (r.answers && r.answers.priority) || 'unspecified';
          if (!pMap[key]) pMap[key] = { priority: key, recommended: 0, accepted: 0 };
          pMap[key].recommended++;
          if (r.accepted) pMap[key].accepted++;
        });
        const byPriority = Object.values(pMap)
          .map(p => ({ ...p, acceptanceRate: p.recommended ? Math.round((p.accepted / p.recommended) * 1000) / 10 : 0 }))
          .sort((a, b) => b.recommended - a.recommended);

        return { total, accepted, acceptanceRate, byVehicle, byPriority };
      });
    },

    /* ── Report 8: Overdue Return Report ─────────────────────────────── */
    getOverdueReturns() {
      return api.getTransactions().then(list => {
        const now = new Date();
        const rows = [];
        list.forEach(b => {
          if (!b.pickupAt || !b.days) return;
          const expected = new Date(new Date(b.pickupAt).getTime() + Number(b.days) * 86400000);
          if (b.status === 'ongoing' && now > expected) {
            rows.push({
              id: b.id, vehicleName: (b.vehicleId || '').replace(/-/g, ' ').toUpperCase(),
              riderName: (b.rider && b.rider.name) || b.riderName || '—',
              expectedReturnDate: expected.toISOString(), returnAt: null,
              daysOverdue: Math.ceil((now - expected) / 86400000), stillOut: true
            });
          } else if (b.status === 'completed' && b.returnAt) {
            const actual = new Date(b.returnAt);
            if (actual > expected) {
              rows.push({
                id: b.id, vehicleName: (b.vehicleId || '').replace(/-/g, ' ').toUpperCase(),
                riderName: (b.rider && b.rider.name) || b.riderName || '—',
                expectedReturnDate: expected.toISOString(), returnAt: b.returnAt,
                daysOverdue: Math.ceil((actual - expected) / 86400000), stillOut: false
              });
            }
          }
        });
        rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
        return rows;
      });
    },

    sendOverdueReminder(id) {
      return api.getTransactions().then(list => {
        const b = list.find(x => x.id === id);
        _logNotification('booking_overdue', {
          subject: 'Overdue Reminder — ' + id,
          recipientId: b ? b.riderId : null,
          recipientName: b ? ((b.rider && b.rider.name) || b.riderName) : null,
          recipientEmail: b ? (b.rider && b.rider.email) : null,
          relatedId: id
        });
        return true;
      });
    },

    /* ── Report 9: Fuel and Mileage Report ───────────────────────────── */
    getFuelMileageReport() {
      return api.getTransactions().then(list => {
        const completed = list.filter(b => b.status === 'completed' && b.odometerStart != null && b.odometerEnd != null);
        const trips = completed.map(b => {
          const mileage = Math.max(0, (b.odometerEnd || 0) - (b.odometerStart || 0));
          const fuelUsedPct = (b.fuelStart != null && b.fuelEnd != null) ? Math.max(0, b.fuelStart - b.fuelEnd) : null;
          return {
            id: b.id, vehicleId: b.vehicleId, vehicleName: (b.vehicleId || '').replace(/-/g, ' ').toUpperCase(),
            riderName: (b.rider && b.rider.name) || b.riderName || '—',
            odometerStart: b.odometerStart, odometerEnd: b.odometerEnd, mileage, fuelUsedPct, returnAt: b.returnAt
          };
        });
        const totalTrips = trips.length;
        const totalMileage = trips.reduce((s, t) => s + t.mileage, 0);

        const vMap = {};
        trips.forEach(t => {
          if (!vMap[t.vehicleId]) vMap[t.vehicleId] = { vehicleName: t.vehicleName, trips: 0, totalMileage: 0, fuelSum: 0, fuelCount: 0 };
          vMap[t.vehicleId].trips++;
          vMap[t.vehicleId].totalMileage += t.mileage;
          if (t.fuelUsedPct != null) { vMap[t.vehicleId].fuelSum += t.fuelUsedPct; vMap[t.vehicleId].fuelCount++; }
        });
        const byVehicle = Object.values(vMap).map(v => ({
          vehicleName: v.vehicleName, trips: v.trips, totalMileage: v.totalMileage,
          avgMileagePerTrip: v.trips ? Math.round(v.totalMileage / v.trips) : 0,
          avgFuelUsedPct: v.fuelCount ? Math.round(v.fuelSum / v.fuelCount) : null
        })).sort((a, b) => b.totalMileage - a.totalMileage);

        trips.sort((a, b) => new Date(b.returnAt || 0) - new Date(a.returnAt || 0));
        return { totalTrips, totalMileage, byVehicle, trips };
      });
    },

    /* ── Report 10: Email Notification Log Report ────────────────────── */
    logNotification(type, data) { return Promise.resolve(_logNotification(type, data)); },
    getNotificationLog() {
      if (!USE_SUPABASE) return Promise.resolve(read(STORAGE_KEYS.notifications, []).slice().reverse());
      return sb().from('notifications').select('*').order('sent_at', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw error;
          return data.map(row => ({
            id: row.id,
            type: row.type,
            subject: row.subject,
            recipientName: row.recipient_name,
            recipientEmail: row.recipient_email,
            relatedId: row.related_id,
            status: row.status,
            sentAt: row.sent_at
          }));
        })
        .catch(err => {
          console.error('[notifications] Supabase fetch failed, falling back to local:', err.message || err);
          return read(STORAGE_KEYS.notifications, []).slice().reverse();
        });
    }
  };

  function _getMaintenanceRecord(vehicleId) {
    const list = read(STORAGE_KEYS.maintenance, []);
    let rec = list.find(m => m.vehicleId === vehicleId);
    if (!rec) {
      let hash = 0;
      for (let i = 0; i < vehicleId.length; i++) hash = (hash * 31 + vehicleId.charCodeAt(i)) % 1000;
      const daysAgo = 10 + (hash % 130); // deterministic 10–139 days ago, varies status across the fleet
      rec = { vehicleId, lastServiceDate: new Date(Date.now() - daysAgo * 86400000).toISOString(), history: [] };
      list.push(rec);
      write(STORAGE_KEYS.maintenance, list);
    }
    return rec;
  }

  function _saveLocalVerification(row) {
    const list = read('wrg_verifications', []);
    const idx = list.findIndex(v => v.userId === row.userId);
    const saved = { ...row, id: idx >= 0 ? list[idx].id : 'VER-' + Date.now() };
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    write('wrg_verifications', list);
    return saved;
  }
  function _readLocalVerification(userId) {
    const list = read('wrg_verifications', []);
    return list.find(v => v.userId === userId) || null;
  }
  function _reviewLocalVerification(id, status, note) {
    const list = read('wrg_verifications', []);
    const idx = list.findIndex(v => v.id === id);
    if (idx >= 0) { list[idx].status = status; list[idx].reviewNote = note || null; list[idx].reviewedAt = new Date().toISOString(); write('wrg_verifications', list); }
    return idx >= 0 ? list[idx] : null;
  }
  function _normalizeVerificationRow(d) {
    return { id: d.id, userId: d.rider_id, userName: d.rider_name, userEmail: d.rider_email,
      govId: d.gov_id, license: d.license_doc, residency: d.residency_doc, clearance: d.clearance_doc,
      birthdate: d.birthdate, agreementAccepted: d.agreement_accepted, depositAmount: d.deposit_amount,
      status: d.status, gateVerdict: d.gate_verdict, score: d.score, riskFlag: d.risk_flag,
      submittedAt: d.submitted_at || d.created_at, reviewedAt: d.reviewed_at, reviewNote: d.review_note };
  }

  // ── REVIEWS (localStorage fallback helpers) ──────────────────────────
  function _saveLocalReview(row) {
    const list = read(STORAGE_KEYS.reviews, []);
    // One review per booking — overwrite if the rider resubmits.
    const idx = list.findIndex(r => String(r.bookingId) === String(row.bookingId));
    const saved = { ...row, id: (idx >= 0 && list[idx].id) || 'REV-' + Date.now() };
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    write(STORAGE_KEYS.reviews, list);
    return saved;
  }
  function _normalizeReviewRow(d) {
    return { id: d.id, bookingId: d.booking_id, riderId: d.rider_id, riderName: d.rider_name,
      riderEmail: d.rider_email, vehicleId: d.vehicle_id, vehicleName: d.vehicle_name,
      rating: d.rating, comment: d.comment, createdAt: d.created_at,
      operatorReply: d.operator_reply || null, repliedAt: d.replied_at || null };
  }
  function _respondLocalReview(id, reply) {
    const list = read(STORAGE_KEYS.reviews, []);
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) { list[idx].operatorReply = reply; list[idx].repliedAt = new Date().toISOString(); write(STORAGE_KEYS.reviews, list); }
    return idx >= 0 ? list[idx] : null;
  }

  // ── SUPPORT TICKETS (localStorage fallback helpers) ───────────────────
  function _saveLocalSupportTicket(row) {
    const list = read(STORAGE_KEYS.supportTickets, []);
    const saved = { ...row, id: 'TCK-' + Date.now() };
    list.push(saved);
    write(STORAGE_KEYS.supportTickets, list);
    return saved;
  }
  function _normalizeSupportTicketRow(d) {
    return { id: d.id, riderId: d.rider_id, name: d.name, email: d.email, category: d.category,
      message: d.message, status: d.status, adminNote: d.admin_note,
      createdAt: d.created_at, resolvedAt: d.resolved_at };
  }

  const NAV_ITEMS = [
    { href: 'index.html',    label: 'Home',            ic: '01', key: 'home' },
    { href: 'tracking.html', label: 'Live Tracking',   ic: '02', key: 'tracking' },
    { href: 'fleet.html',    label: 'Vehicle Fleet',   ic: '03', key: 'fleet' },
    { href: 'wallet.html',   label: 'Secure Checkout', ic: '04', key: 'wallet' }
  ];

  function renderShell(activeKey) {
    const sidebar = document.getElementById('wrg-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = `
      <div class="brand"><div class="brand-mark">W</div><div class="brand-name">WHEEL<b>RENTRA</b>GO</div></div>
      <div class="nav-status"><span class="dot-live"></span> SYSTEM ONLINE</div>
      <ul class="nav-list">
        ${NAV_ITEMS.map(item => `<li><a class="nav-item ${item.key === activeKey ? 'active' : ''}" href="${item.href}"><span class="ic">${item.ic}</span> ${item.label}</a></li>`).join('')}
      </ul>
      <div class="sidebar-foot"><span>BUILD v1.0 - CAPSTONE</span><span>UNIT REGION: NCR-PH</span></div>
    `;
    const toggle = document.getElementById('wrg-mobile-toggle');
    if (toggle) toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  function toast(message) {
    let el = document.getElementById('wrg-toast');
    if (!el) { el = document.createElement('div'); el.id = 'wrg-toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function peso(n) { return '\u20b1' + Number(n).toLocaleString('en-PH'); }

  return { api, renderShell, toast, peso, FLEET, USE_SUPABASE, _rowToBooking };
})();

/* ══════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════ */
;(function() {
  const SK = 'wrg_session';
  const USE_SUPABASE = WRG.USE_SUPABASE;
  // Reuses the single global sb() client defined at the top of this file —
  // no more calling createClient() again here.

  /* ── LOYALTY PROGRAM ──────────────────────────────────────────────────
     Points are recomputed from the rider's own booking history every
     call (never trusted from a stored "points" field), so nothing here
     can be edited client-side to inflate a balance. Only 'completed'
     bookings earn points — pending/cancelled/rejected rides earn
     nothing. Redemptions are a simple append-only ledger in
     localStorage: available balance = lifetime earned − lifetime spent
     on redemptions (points are never "returned" to the balance). This
     works identically in Supabase and local-demo mode since both modes
     already return bookings in the same shape via getMyBookings(). */
  const LOYALTY_KEY = 'wrg_loyalty_redemptions';
  const POINTS_PER_BOOKING = 100;
  const PESOS_PER_POINT = 50; // every ₱50 spent on a completed booking = 1 pt

  const LOYALTY_TIERS = [
    { key: 'bronze',   label: 'Bronze',   min: 0,    perk: 'Earn points on every completed ride' },
    { key: 'silver',   label: 'Silver',   min: 500,  perk: 'Early access to new fleet drops' },
    { key: 'gold',     label: 'Gold',     min: 1500, perk: 'Priority admin approval queue' },
    { key: 'platinum', label: 'Platinum', min: 3500, perk: 'Dedicated support line + surprise perks' }
  ];

  const LOYALTY_REWARDS = [
    { id: 'discount-100',  label: '₱100 Off Next Booking',   cost: 200,  value: 100 },
    { id: 'discount-300',  label: '₱300 Off Next Booking',   cost: 550,  value: 300 },
    { id: 'discount-750',  label: '₱750 Off Next Booking',   cost: 1300, value: 750 },
    { id: 'discount-1500', label: '₱1,500 Off Next Booking', cost: 2600, value: 1500 }
  ];

  function _loyaltyTierFor(points) {
    let tier = LOYALTY_TIERS[0];
    for (const t of LOYALTY_TIERS) { if (points >= t.min) tier = t; }
    const idx = LOYALTY_TIERS.indexOf(tier);
    const next = LOYALTY_TIERS[idx + 1] || null;
    return {
      tier: tier.key, tierLabel: tier.label, perk: tier.perk,
      nextTierLabel: next ? next.label : null,
      pointsToNext: next ? Math.max(0, next.min - points) : 0,
      tierMin: tier.min, nextMin: next ? next.min : null
    };
  }

  function _readLoyaltyLedger() {
    try { return JSON.parse(localStorage.getItem(LOYALTY_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _writeLoyaltyLedger(list) {
    try { localStorage.setItem(LOYALTY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function _genPromoCode() {
    return 'WRG-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  Object.assign(WRG.api, {

    register({ name, email, license, password }) {
      if (USE_SUPABASE) {
        return sb().auth.signUp({ email, password, options: { data: { name, license } } })
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            const user = { id: data.user.id, name, email, license, joinedAt: data.user.created_at };
            localStorage.setItem(SK, JSON.stringify(user));
            return user;
          });
      }
      const existing = JSON.parse(localStorage.getItem('wrg_users') || '[]');
      if (existing.find(u => u.email === email)) return Promise.reject(new Error('Email already registered.'));
      const user = { id: 'USR-' + Date.now(), name, email, license, joinedAt: new Date().toISOString() };
      existing.push({ ...user, password });
      localStorage.setItem('wrg_users', JSON.stringify(existing));
      localStorage.setItem(SK, JSON.stringify(user));
      return Promise.resolve(user);
    },

    login({ email, password }) {
      if (USE_SUPABASE) {
        return sb().auth.signInWithPassword({ email, password })
          .then(({ data, error }) => {
            if (error) throw new Error('Invalid email or password.');
            const meta = data.user.user_metadata || {};
            const user = { id: data.user.id, name: meta.name || email, email, license: meta.license || '', joinedAt: data.user.created_at };
            localStorage.setItem(SK, JSON.stringify(user));
            return user;
          });
      }
      const users = JSON.parse(localStorage.getItem('wrg_users') || '[]');
      const user = users.find(u => u.email === email && u.password === password);
      if (!user) return Promise.reject(new Error('Invalid email or password.'));
      const { password: _pw, ...session } = user;
      localStorage.setItem(SK, JSON.stringify(session));
      return Promise.resolve(session);
    },

    logout() {
      localStorage.removeItem(SK);
      if (USE_SUPABASE) {
        return sb().auth.signOut()
          .catch(() => { /* token already dead — fine, we clean up below anyway */ })
          .then(() => { _clearSupabaseStorage(); return true; });
      }
      return Promise.resolve(true);
    },

    // IMPORTANT: this must match the *live* Supabase Auth session, not
    // just a locally cached copy — every write that stamps `rider_id`
    // (bookings, recommendations, reviews, verifications, ...) relies on
    // this id equaling auth.uid() for RLS's `rider_id = auth.uid()`
    // checks to pass. A stale/mismatched cached id here silently causes
    // 403s on INSERT/UPDATE even though the RLS policies themselves are
    // written correctly. See getAdminSession() below, which already does
    // this the right way for the admin flow.
    getSession() {
      if (!USE_SUPABASE) {
        try { const raw = localStorage.getItem(SK); return Promise.resolve(raw ? JSON.parse(raw) : null); }
        catch { return Promise.resolve(null); }
      }
      return sb().auth.getSession().then(({ data }) => {
        const authUser = data && data.session && data.session.user;
        if (!authUser) { localStorage.removeItem(SK); return null; }
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(SK) || 'null'); } catch { /* ignore */ }
        const meta = authUser.user_metadata || {};
        // Live auth.uid()/email always win; keep cached name/license only
        // when they still belong to this same authenticated user.
        const session = {
          id: authUser.id,
          email: authUser.email,
          name: (cached && cached.id === authUser.id && cached.name) || meta.name || authUser.email,
          license: (cached && cached.id === authUser.id && cached.license) || meta.license || '',
          joinedAt: authUser.created_at
        };
        localStorage.setItem(SK, JSON.stringify(session));
        return session;
      }).catch(() => {
        try { const raw = localStorage.getItem(SK); return raw ? JSON.parse(raw) : null; }
        catch { return null; }
      });
    },

    /* ── FORGOT PASSWORD ────────────────────────────────────────────────
       Uses Supabase Auth's built-in recovery email. requestPasswordReset
       sends the "reset your password" email with a link back to
       reset-password.html; that page (via updatePassword below) sets the
       new password once the rider follows the link. Both require real
       Supabase — there's no email server in local/offline mode. */
    requestPasswordReset(email) {
      if (!USE_SUPABASE) return Promise.reject(new Error('Password reset needs the live server — not available in offline demo mode.'));
      const redirectTo = window.location.href.replace(/login\.html.*$/, 'reset-password.html');
      return sb().auth.resetPasswordForEmail(email, { redirectTo })
        .then(({ error }) => { if (error) throw new Error(error.message); return true; });
    },

    updatePassword(newPassword) {
      if (!USE_SUPABASE) return Promise.reject(new Error('Password reset needs the live server — not available in offline demo mode.'));
      return sb().auth.updateUser({ password: newPassword })
        .then(({ error }) => { if (error) throw new Error(error.message); return true; });
    },

    requireAuth() {
      return WRG.api.getSession().then(session => {
        if (!session) window.location.href = 'login.html';
        return session;
      });
    },

    updateProfile({ name, license }) {
      if (USE_SUPABASE) {
        return sb().auth.updateUser({ data: { name, license } })
          .then(({ error }) => {
            if (error) throw new Error(error.message);
            return WRG.api.getSession().then(session => {
              const updated = { ...session, name, license };
              localStorage.setItem(SK, JSON.stringify(updated));
              return updated;
            });
          });
      }
      return WRG.api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('Not logged in'));
        const updated = { ...session, name, license };
        localStorage.setItem(SK, JSON.stringify(updated));
        const users = JSON.parse(localStorage.getItem('wrg_users') || '[]');
        const idx = users.findIndex(u => u.id === session.id);
        if (idx >= 0) { users[idx] = { ...users[idx], name, license }; localStorage.setItem('wrg_users', JSON.stringify(users)); }
        return Promise.resolve(updated);
      });
    },

    getMyBookings() {
      if (USE_SUPABASE) {
        return WRG.api.getSession().then(session => {
          if (!session) return [];
          return sb().from('bookings').select('*').eq('rider_id', session.id).order('created_at', { ascending: false })
            .then(({ data, error }) => error ? [] : data.map(WRG._rowToBooking));
        });
      }
      return WRG.api.getSession().then(session => {
        const list = JSON.parse(localStorage.getItem('wrg_bookings') || '[]');
        const mine = session ? list.filter(b => b.riderId === session.id) : list;
        return mine.slice().reverse();
      });
    },

    /* ── ADMIN AUTH ──────────────────────────────────────────────────────
       Admin is just a Supabase-authenticated user whose row in `profiles`
       has role = 'admin'. There is NO client-side password and NO
       client-trusted "is admin" flag — the only reason any admin-only
       query below (getAllUsers, getAllBookings, reviewVerification, ...)
       actually returns data is that the database's Row Level Security
       policies check auth.uid()'s role themselves. A `wrg_admin_ui`
       localStorage flag is kept ONLY to remember which screen to show on
       load; if it's wrong or forged, the Supabase queries simply come
       back empty/denied because RLS doesn't trust it either. See
       admin-rls-policies.sql for the server-side policies this depends on. */
    adminLogin({ email, password }) {
      if (!USE_SUPABASE) return Promise.reject(new Error('Admin login needs the live server — not available in offline demo mode.'));
      return sb().auth.signInWithPassword({ email, password })
        .then(({ data, error }) => {
          if (error) throw new Error('Invalid email or password.');
          return sb().from('profiles').select('role,name').eq('id', data.user.id).single()
            .then(({ data: profile, error: profErr }) => {
              if (profErr || !profile || profile.role !== 'admin') {
                return sb().auth.signOut().then(() => {
                  throw new Error('This account does not have admin access.');
                });
              }
              const session = { role: 'admin', name: profile.name || email, loginAt: new Date().toISOString() };
              localStorage.setItem('wrg_admin_ui', JSON.stringify(session));
              return session;
            });
        });
    },

    adminLogout() {
      localStorage.removeItem('wrg_admin_ui');
      if (USE_SUPABASE) {
        return sb().auth.signOut().catch(() => {}).then(() => true);
      }
      return Promise.resolve(true);
    },

    /* Re-verifies against the live Supabase session + profiles.role on
       every check (e.g. page load) instead of trusting the localStorage
       flag by itself — a forged flag with no matching authenticated
       admin session resolves to null and the login screen is shown. */
    getAdminSession() {
      if (!USE_SUPABASE) return Promise.resolve(null);
      return sb().auth.getSession().then(({ data }) => {
        const authUser = data && data.session && data.session.user;
        if (!authUser) { localStorage.removeItem('wrg_admin_ui'); return null; }
        return sb().from('profiles').select('role,name').eq('id', authUser.id).single()
          .then(({ data: profile }) => {
            if (!profile || profile.role !== 'admin') { localStorage.removeItem('wrg_admin_ui'); return null; }
            const session = { role: 'admin', name: profile.name || authUser.email, loginAt: new Date().toISOString() };
            localStorage.setItem('wrg_admin_ui', JSON.stringify(session));
            return session;
          });
      }).catch(() => null);
    },

    getAllUsers() {
      if (USE_SUPABASE) {
        return sb().from('profiles').select('*').order('created_at', { ascending: false })
          .then(({ data, error }) => error ? [] : data);
      }
      const users = JSON.parse(localStorage.getItem('wrg_users') || '[]');
      return Promise.resolve(users.map(({ password: _pw, ...u }) => u));
    },

    /* ── ADMIN VEHICLE ASSIGNMENT ─────────────────────────────────────────
       Lets an admin manually pin a specific vehicle to a specific rider's
       profile (profiles.assigned_vehicle) — separate from the normal
       self-serve booking flow (fleet.html → wallet.html → bookings table).
       This does NOT create a booking and does NOT reserve/hold the
       vehicle from other renters; it's purely a label admins can use for
       fleet-management purposes (e.g. long-term/corporate riders). Pass
       vehicleId = null (or omit) to clear the assignment. */
    assignVehicleToRider(riderId, vehicleId) {
      if (!riderId) return Promise.reject(new Error('Rider ID is required.'));
      if (USE_SUPABASE) {
        return sb().from('profiles').update({ assigned_vehicle: vehicleId || null }).eq('id', riderId).select().single()
          .then(({ data, error }) => { if (error) throw new Error(error.message); return data; });
      }
      const users = JSON.parse(localStorage.getItem('wrg_users') || '[]');
      const idx = users.findIndex(u => String(u.id) === String(riderId));
      if (idx < 0) return Promise.reject(new Error('Rider not found.'));
      users[idx] = { ...users[idx], assigned_vehicle: vehicleId || null };
      localStorage.setItem('wrg_users', JSON.stringify(users));
      const { password: _pw, ...clean } = users[idx];
      return Promise.resolve(clean);
    },

    getAllBookings() {
      if (USE_SUPABASE) {
        return sb().from('bookings').select('*').order('created_at', { ascending: false })
          .then(({ data, error }) => error ? JSON.parse(localStorage.getItem('wrg_bookings') || '[]') : data.map(WRG._rowToBooking));
      }
      const list = JSON.parse(localStorage.getItem('wrg_bookings') || '[]');
      return Promise.resolve(list.slice().reverse());
    },

    /* ── LOYALTY: STATUS ────────────────────────────────────────────── */
    getLoyaltyStatus() {
      return WRG.api.getMyBookings().then(bookings => {
        const completed = (bookings || []).filter(b => b.status === 'completed');
        const totalSpent = completed.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
        const earned = completed.length * POINTS_PER_BOOKING + Math.floor(totalSpent / PESOS_PER_POINT);
        return WRG.api.getSession().then(session => {
          const mine = session ? _readLoyaltyLedger().filter(r => r.riderId === session.id) : [];
          const spentOnRedemptions = mine.reduce((sum, r) => sum + (Number(r.pointsCost) || 0), 0);
          const points = Math.max(0, earned - spentOnRedemptions);
          return {
            points,
            earnedLifetime: earned,
            spentOnRedemptions,
            completedBookings: completed.length,
            totalSpent,
            ..._loyaltyTierFor(points)
          };
        });
      });
    },

    getLoyaltyRewards() {
      return Promise.resolve(LOYALTY_REWARDS.slice());
    },

    getMyRewardCodes() {
      return WRG.api.getSession().then(session => {
        if (!session) return [];
        return _readLoyaltyLedger().filter(r => r.riderId === session.id).slice().reverse();
      });
    },

    /* ── LOYALTY: REDEEM ────────────────────────────────────────────────
       Spends points immediately and mints a one-time promo code for the
       rider. Re-checks the live computed balance right before writing,
       so two redemptions can't double-spend the same points in this
       single-tab demo. */
    redeemReward(rewardId) {
      const reward = LOYALTY_REWARDS.find(r => r.id === rewardId);
      if (!reward) return Promise.reject(new Error('Unknown reward.'));
      return WRG.api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('Please sign in to redeem rewards.'));
        return WRG.api.getLoyaltyStatus().then(status => {
          if (status.points < reward.cost) return Promise.reject(new Error('Not enough points for this reward yet.'));
          const record = {
            code: _genPromoCode(),
            riderId: session.id,
            rewardId: reward.id,
            label: reward.label,
            value: reward.value,
            pointsCost: reward.cost,
            used: false,
            redeemedAt: new Date().toISOString(),
            usedAt: null
          };
          const list = _readLoyaltyLedger();
          list.push(record);
          _writeLoyaltyLedger(list);
          return record;
        });
      });
    },

    // Validates + previews a code at checkout without consuming it yet —
    // see markPromoCodeUsed() for the actual consume step, called only
    // once a booking is successfully submitted.
    applyPromoCode(code) {
      return WRG.api.getSession().then(session => {
        if (!session) return Promise.reject(new Error('Please sign in first.'));
        const norm = String(code || '').trim().toUpperCase();
        if (!norm) return Promise.reject(new Error('Enter a code.'));
        const record = _readLoyaltyLedger().find(r => r.code === norm && r.riderId === session.id);
        if (!record) return Promise.reject(new Error('Code not found on your account.'));
        if (record.used) return Promise.reject(new Error('This code has already been used.'));
        return record;
      });
    },

    markPromoCodeUsed(code) {
      const norm = String(code || '').trim().toUpperCase();
      const list = _readLoyaltyLedger();
      const idx = list.findIndex(r => r.code === norm);
      if (idx >= 0) { list[idx] = { ...list[idx], used: true, usedAt: new Date().toISOString() }; _writeLoyaltyLedger(list); }
      return Promise.resolve(idx >= 0 ? list[idx] : null);
    }
  });
})();

// ── PWA SERVICE WORKER REGISTRATION ──────────────────────
// app.js is loaded on every page, so registering here (once) covers the
// whole site instead of repeating a <script> block on each HTML file.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Non-fatal — app still works as a normal website if this fails
      // (e.g. served over plain http instead of https/localhost).
    });
  });
}