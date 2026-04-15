import os, json, requests, pickle
from math import radians, cos, sin, asin, sqrt
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from functools import wraps
from dotenv import load_dotenv
import sqlite3
from datetime import datetime

# ── JSON file paths ─────────────────────────────────────────
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
BOOKINGS_FILE   = os.path.join(BASE_DIR, "data", "bookings.json")
HOSPITALS_FILE  = os.path.join(BASE_DIR, "data", "hospitals.json")

def safe_col_mean(df, names):
    import pandas as pd
    # Create a lowercase map of columns to handle case sensitivity
    lc = {c.lower(): c for c in df.columns}
    for n in names:
        if n.lower() in lc:
            val = df[lc[n.lower()]].mean()
            return float(val) if not pd.isna(val) else 0.0
    return 0.0

def _ensure_data_dir():
    """Create data/ directory and empty JSON files if missing."""
    data_dir = os.path.join(BASE_DIR, "data")
    os.makedirs(data_dir, exist_ok=True)
    for path in (BOOKINGS_FILE, HOSPITALS_FILE):
        if not os.path.exists(path):
            with open(path, "w") as f:
                json.dump([], f)

_ensure_data_dir()

# ── JSON helpers ────────────────────────────────────────────
def _read_json(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def _write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ── SQLite DB ────────────────────────────────────────────────
conn   = sqlite3.connect("hospital_db.db", check_same_thread=False)
cursor = conn.cursor()
cursor.execute("""
CREATE TABLE IF NOT EXISTS hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, zipcode TEXT, address TEXT,
    specialty TEXT, phone TEXT, email TEXT
)""")
cursor.execute("""
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name TEXT, hospital_name TEXT,
    specialty TEXT, date TEXT, time TEXT, phone TEXT
)""")
conn.commit()

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "corvia-super-secret-2024")

# ── Haversine ────────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    return round(2 * asin(sqrt(a)) * 6371, 2)


# ════════════════════════════════════════════════════════════
#  MODEL LOADING
# ════════════════════════════════════════════════════════════
_model_cache = {}

def load_model():
    if _model_cache:
        return _model_cache["model"], _model_cache["feat"], _model_cache["enc"]
    import xgboost as xgb
    mp = os.path.join(BASE_DIR, "models", "heart_risk_model.json")
    fp = os.path.join(BASE_DIR, "models", "feature_columns.pkl")
    ep = os.path.join(BASE_DIR, "models", "label_encoder_sex.pkl")
    missing = [name for name, path in [
        ("heart_risk_model.json", mp),
        ("feature_columns.pkl",   fp),
        ("label_encoder_sex.pkl", ep),
    ] if not os.path.exists(path)]
    if missing:
        raise RuntimeError(f"Missing model files: {', '.join(missing)}")
    mdl = xgb.XGBRegressor()
    mdl.load_model(mp)
    with open(fp, "rb") as f: feat_cols = pickle.load(f)
    with open(ep, "rb") as f: label_enc = pickle.load(f)
    if mdl.n_features_in_ != len(feat_cols):
        raise RuntimeError(f"Feature mismatch: model expects {mdl.n_features_in_} but pkl has {len(feat_cols)}.")
    _model_cache["model"] = mdl
    _model_cache["feat"]  = feat_cols
    _model_cache["enc"]   = label_enc
    return mdl, feat_cols, label_enc


def build_input_row(data):
    return {
        "Age":                  data.get("age", 50),
        "Sex_encoded":          1 if data.get("sex") == "male" else 0,
        "Total_Cholesterol":    data.get("total_chol", 210),
        "HDL_Cholesterol":      data.get("hdl_chol", 45),
        "Systolic_BP":          data.get("sys_bp", 130),
        "Diastolic_BP":         data.get("dia_bp", 85),
        "On_BP_Medication":     1 if data.get("on_med") == "yes" else 0,
        "Diabetes":             1 if data.get("diabetes") == "yes" else 0,
        "Smoker":               1 if data.get("smoker") == "current" else 0,
        "Step count":           data.get("steps", 0),
        "Move Minutes count":   data.get("move_min", 0),
        "Calories (kcal)":      data.get("calories", 0),
        "Distance (m)":         data.get("distance", 0),
        "Heart Points":         data.get("hp", 0),
        "Heart Minutes":        data.get("hm", 0),
        "Average speed (m/s)":  data.get("avg_spd", 0),
        "Max speed (m/s)":      data.get("max_spd", 0),
        "Min speed (m/s)":      data.get("min_spd", 0),
        "Average weight (kg)":  data.get("avg_wt", 0),
        "Max weight (kg)":      data.get("max_wt", 0),
        "Min weight (kg)":      data.get("min_wt", 0),
        "Walking duration (ms)":data.get("walk_dur", 0),
    }


def get_risk_category(r):
    if r < 5:     return "Low Risk",          "low",          "#28a745"
    elif r < 7.5: return "Borderline Risk",   "borderline",   "#ffc107"
    elif r < 20:  return "Intermediate Risk", "intermediate", "#fd7e14"
    else:         return "High Risk",         "high",         "#dc3545"


def build_recommendations(risk, age, sys_bp, total_chol, hdl_chol, steps, smoker, diabetes, on_med):
    """
    Returns three lists: doing_well, improve, critical.
    """
    doing_well, improve, critical = [], [], []

    # ── Doing Well ────────────────────────────────────────────
    if steps >= 8000:          doing_well.append("Good daily step count (≥8,000 steps)")
    if hdl_chol >= 50:         doing_well.append("Healthy HDL cholesterol level")
    if sys_bp < 120:           doing_well.append("Optimal blood pressure (<120/80 mmHg)")
    elif sys_bp < 130:         doing_well.append("Blood pressure within normal range")
    if smoker != "current":    doing_well.append("Non-smoker or former smoker")
    if diabetes == "no":       doing_well.append("No diabetes reported")
    if total_chol < 200:       doing_well.append("Total cholesterol within desirable range (<200 mg/dL)")
    if not doing_well:         doing_well.append("You've taken the first step — completing this assessment!")

    # ── LOW RISK (<5%) ────────────────────────────────────────
    if risk < 5:
        improve = [
            "Healthy lifestyle habits should be emphasized as the primary approach to maintain low risk; no pharmacotherapy is indicated.",
            "Engage in at least 150 minutes of moderate intensity or 75 minutes of vigorous-intensity aerobic exercise weekly, plus muscle-strengthening activities twice weekly.",
            "Follow Mediterranean-style or DASH dietary pattern rich in fruits, vegetables, whole grains, lean protein, and healthy fats.",
            "Check blood pressure, cholesterol, and blood glucose every 4–6 years; maintain BP <120/80 mmHg, LDL-C <100 mg/dL, and HbA1c <5.7%.",
            "Never smoke; if you smoke, pursue cessation immediately; limit alcohol to ≤1 drink/day (women) or ≤2 drinks/day (men).",
            "Aim for 7–9 hours of quality sleep per night; consistent sleep schedules are associated with lower CVD risk.",
        ]
        if steps < 8000:        improve.append(f"Increase daily steps — currently {int(steps):,}/day, target 8,000–10,000.")
        if smoker == "current": improve.append("Quit smoking immediately — pursue cessation support now.")
        critical = [
            "No pharmacotherapy indicated — healthy lifestyle is the primary approach.",
            "Schedule annual health check-up; continue monitoring BP, weight & waist circumference.",
            "No statin therapy required at this risk level — maintain current habits.",
        ]

    # ── BORDERLINE RISK (5–7.5%) ─────────────────────────────
    elif risk < 7.5:
        improve = [
            "If risk enhancers (e.g., family history of premature ASCVD, chronic kidney disease, LDL-C ≥160 mg/dL) are present, a clinician–patient risk discussion may justify statin initiation.",
            "If statin is initiated, aim for LDL-C reduction of 30–49% with moderate-intensity therapy.",
            "Limit saturated fat to <6% of total daily calories; replace with unsaturated fats; reduce sodium to <2,300 mg/day (optimal <1,500 mg/day).",
            "Progress toward 300 minutes/week of moderate activity for greater cardiovascular benefit.",
            "If risk discussion remains uncertain, CAC testing can guide decision-making; a CAC score >100 favors statin initiation.",
            "If BP is elevated, initiate lifestyle modifications; consider pharmacotherapy if BP remains ≥130/80 mmHg.",
        ]
        if sys_bp >= 130:       improve.append(f"BP is {sys_bp} mmHg — initiate lifestyle modifications; consider pharmacotherapy if BP remains ≥130/80 mmHg.")
        if total_chol > 200:    improve.append(f"Total cholesterol {total_chol} mg/dL — aim for LDL-C <100 mg/dL through diet & possible statin therapy.")
        if smoker == "current": improve.append("Quit smoking NOW — single biggest modifiable cardiovascular risk factor.")
        if diabetes == "yes":   improve.append("Maintain glycaemic control — HbA1c target <7%.")
        critical = [
            "If risk-enhancers present, clinician–patient risk discussion may justify statin initiation (target 30–49% LDL-C reduction with moderate-intensity therapy).",
            "If risk discussion remains uncertain, CAC (Coronary Artery Calcium) scoring can guide decision — CAC score >100 favours statin initiation.",
        ]
        if sys_bp >= 130:
            critical.append(f"BP {sys_bp} mmHg — if lifestyle changes insufficient, consider pharmacotherapy to achieve <130/80 mmHg.")
        critical.append("Schedule preventive cardiology review within 3 months.")

    # ── INTERMEDIATE RISK (7.5–20%) ───────────────────────────
    elif risk < 20:
        improve = [
            "Initiate Moderate-Intensity Statin.",
            "Aim for LDL-C <100 mg/dL (or <70 mg/dL with risk enhancers).",
            "For patients on maximally tolerated statin with LDL-C ≥70 mg/dL, ezetimibe is a safe and effective add-on to achieve goal.",
            "Combine dietary changes (Mediterranean diet), structured exercise program, and weight loss (target 5–10% reduction).",
            "Strict BP control (<130/80 mmHg); optimize glycemic control if diabetic (HbA1c <7%).",
        ]
        if smoker == "current": improve.append("Quit smoking immediately — single highest-impact modifiable risk factor.")
        if diabetes == "yes":   improve.append("Optimise glycaemic control — HbA1c target <7%.")
        if total_chol > 200:    improve.append(f"Cholesterol {total_chol} mg/dL: if LDL-C ≥70 mg/dL on maximally tolerated statin, add ezetimibe.")
        critical = [
            "INTERMEDIATE RISK — initiate moderate-intensity statin now; discuss with your cardiologist within 30 days.",
            "If LDL-C ≥70 mg/dL on maximally tolerated statin, ezetimibe is recommended as add-on therapy.",
        ]
        if sys_bp >= 130:
            critical.append(f"BP {sys_bp} mmHg requires strict control — target <130/80 mmHg; pharmacotherapy likely needed.")
        critical.append("Reassess 10-year risk after 6 months; develop long-term maintenance plan with 3–6 month follow-up.")

    # ── HIGH RISK (≥20%) ──────────────────────────────────────
    else:
        improve = [
            "Initiate High-Intensity Statin.",
            "If baseline LDL-C is ≥70 mg/dL, high-intensity statin is required; if LDL-C remains ≥70 mg/dL, consider adding ezetimibe or PCSK9 inhibitors.",
            "For patients with LDL-C ≥70 mg/dL on maximally tolerated statin, ezetimibe, bempedoic acid, or PCSK9 inhibitors should be considered.",
            "For adults aged 40–70 years with high risk and low bleeding risk, low-dose aspirin may be considered for primary prevention.",
            "Achieve BP <130/80 mmHg, HbA1c <7% (if diabetic), and BMI <25 or target 5–10% weight loss.",
            "Referral to outpatient cardiac rehabilitation is strongly recommended for secondary prevention; structured lifestyle programs improve outcomes.",
        ]
        if diabetes == "yes":   improve.append("Strict glycaemic control — HbA1c <7%; BP <130/80 mmHg if diabetic.")
        if 40 <= age <= 70:     improve.append("For age 40–70 with low bleeding risk, low-dose aspirin may be considered — discuss with doctor.")
        if smoker == "current": improve.append("Quit smoking IMMEDIATELY — provides the single largest modifiable risk reduction.")
        critical = [
            "HIGH RISK (≥20%) — consult a cardiologist URGENTLY within 30 days.",
            "High-intensity statin is mandatory; if LDL-C ≥70 mg/dL persists, consider PCSK9 inhibitors.",
        ]
        if sys_bp >= 130:
            critical.append(f"BP {sys_bp} mmHg — achieve <130/80 mmHg urgently; pharmacotherapy required.")
        critical.append("Referral to outpatient cardiac rehabilitation is strongly recommended — structured lifestyle programs improve outcomes.")
        if risk >= 30:
            critical.append("VERY HIGH RISK — if multiple ASCVD events, target LDL-C <55 mg/dL; 3-month follow-up mandatory.")
        critical.append("Reassess 10-year risk after 6 months; transition to long-term management with 3-month follow-up schedule.")

    return doing_well, improve, critical


def get_action_plan(risk):
    if risk < 5:
        return [
            {"phase":"Phase 1 · Months 1–2","title":"Lifestyle Foundation","desc":"Maintain 150–300 min/week moderate physical activity · Mediterranean/DASH diet · 7–9 hrs sleep nightly · BP monthly, lipids every 4–6 yrs."},
            {"phase":"Phase 2 · Months 3–4","title":"Optimisation","desc":"Increase activity to 300 min/week · Add resistance training 2×/week · Sodium <2,300 mg/day; saturated fat <10% of calories."},
            {"phase":"Phase 3 · Months 5–6","title":"Long-term Maintenance","desc":"Establish sustainable routine · Annual health check-up · Monitor BP, weight & waist circumference."},
        ]
    elif risk < 7.5:
        return [
            {"phase":"Phase 1 · Months 1–2","title":"Assessment & Foundation","desc":"Baseline lipid panel, BP & weight · 150 min/week moderate activity · Mediterranean diet; saturated fat <6% · Statin if LDL-C ≥160 mg/dL."},
            {"phase":"Phase 2 · Months 3–4","title":"Intensification","desc":"200–300 min/week activity · Recheck lipids at 4–8 wks · Aim LDL-C <100 mg/dL; BP <130/80 mmHg · Consider CAC scoring if uncertain."},
            {"phase":"Phase 3 · Months 5–6","title":"Optimisation","desc":"If LDL-C not at goal, intensify statin or add ezetimibe · Reassess 10-year risk · 6-month follow-up with doctor."},
        ]
    elif risk < 20:
        return [
            {"phase":"Phase 1 · Months 1–2","title":"Initiate Therapy","desc":"Baseline lipids, BP, HbA1c & weight · Moderate-to-high statin (30–49% LDL-C reduction) · 150 min/week + resistance 2×/week · DASH diet, sodium <2,300 mg/day."},
            {"phase":"Phase 2 · Months 3–4","title":"Monitor & Adjust","desc":"Recheck LDL-C at 4–8 wks; adjust statin · 200–300 min/week · Target LDL-C <100 mg/dL; add ezetimibe if LDL-C ≥70 mg/dL · BP <130/80 mmHg."},
            {"phase":"Phase 3 · Months 5–6","title":"Optimisation","desc":"Consider PCSK9 inhibitor if LDL-C ≥70 mg/dL remains · Reassess 10-year risk · 3–6 month follow-up plan."},
        ]
    else:
        return [
            {"phase":"Phase 1 · Months 1–2","title":"Immediate Intervention","desc":"Full baseline panel (lipids, HbA1c, creatinine, LFTs) · High-intensity statin NOW · Cardiac rehab or supervised exercise · DASH diet; sodium <1,500 mg/day."},
            {"phase":"Phase 2 · Months 3–4","title":"Intensify & Monitor","desc":"Recheck LDL-C at 4–8 wks; target <70 mg/dL · Add ezetimibe if ≥70 mg/dL · Achieve BP <130/80 mmHg · HbA1c <7% if diabetic."},
            {"phase":"Phase 3 · Months 5–6","title":"Optimisation","desc":"If LDL-C <70 mg/dL achieved, continue therapy · If very high risk, consider LDL-C <55 mg/dL · Reassess risk · 3-month follow-up."},
        ]


# ════════════════════════════════════════════════════════════
#  PAGE ROUTES
# ════════════════════════════════════════════════════════════

@app.route("/")
@app.route("/mission")
@app.route("/mission.html")
def mission():
    return render_template("mission.html")

@app.route("/about")
@app.route("/about.html")
def about():
    return render_template("about.html")

@app.route("/risk-check")
@app.route("/risk-check.html")
def risk_check():
    return render_template("risk-check.html")

@app.route("/my-report")
@app.route("/my-report.html")
def my_report():
    return render_template("my-report.html")

@app.route("/find-hospital")
def find_hospital():
    return render_template("find-hospital.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html", name="User")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("about"))


# ════════════════════════════════════════════════════════════
#  API ROUTES
# ════════════════════════════════════════════════════════════

@app.route("/api/predict", methods=["POST"])
def predict():
    import pandas as pd
    data = request.get_json()
    try:
        model, feature_columns, label_encoder = load_model()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    row = build_input_row(data)
    try:
        input_df = pd.DataFrame([row])[feature_columns]
    except KeyError as e:
        return jsonify({"error": f"Feature column mismatch: {e}"}), 500
    try:
        risk = float(model.predict(input_df)[0])
        if risk <= 1.0: risk *= 100
        risk = round(risk, 1)
    except Exception as e:
        return jsonify({"error": f"Prediction failed: {e}"}), 500

    age        = data.get("age", 50)
    sys_bp     = data.get("sys_bp", 130)
    total_chol = data.get("total_chol", 210)
    hdl_chol   = data.get("hdl_chol", 45)
    steps      = data.get("steps", 5000)
    smoker     = data.get("smoker", "never")
    diabetes   = data.get("diabetes", "no")
    on_med     = data.get("on_med", "no")

    cat_label, cat_key, cat_color = get_risk_category(risk)
    doing_well, improve, critical = build_recommendations(
        risk, age, sys_bp, total_chol, hdl_chol, steps, smoker, diabetes, on_med
    )
    plan = get_action_plan(risk)

    base_tbl = {
        "male":   {30:3, 40:6, 50:10, 60:16, 70:22},
        "female": {30:1.5, 40:3, 50:6, 60:10, 70:16},
    }
    sex_key  = "male" if data.get("sex") == "male" else "female"
    ages_s   = sorted(base_tbl[sex_key].keys())
    baseline = base_tbl[sex_key][ages_s[0]]
    for a in reversed(ages_s):
        if age >= a:
            baseline = base_tbl[sex_key][a]
            break

    age_c  = min(age / 70 * 30, 30)
    bp_c   = min((sys_bp - 100) / 80 * 25, 25) if sys_bp > 100 else 5
    chol_c = min((total_chol - 150) / 150 * 20, 20) if total_chol > 150 else 5
    life_c = min(
        max(0, 15 - (steps / 10000 * 15))
        + (10 if smoker == "current" else 0)
        + (8  if diabetes == "yes"   else 0), 35
    )
    tot_c  = age_c + bp_c + chol_c + life_c
    drivers = {
        "Age":            round(age_c  / tot_c * 100, 1),
        "Blood Pressure": round(bp_c   / tot_c * 100, 1),
        "Cholesterol":    round(chol_c / tot_c * 100, 1),
        "Lifestyle":      round(life_c / tot_c * 100, 1),
    }

    return jsonify({
        "risk":       risk,
        "category":   cat_label,
        "cat_key":    cat_key,
        "cat_color":  cat_color,
        "baseline":   baseline,
        "doing_well": doing_well,
        "improve":    improve,
        "critical":   critical,
        "plan":       plan,
        "drivers":    drivers,
    })


@app.route('/api/upload_health_data', methods=['POST'])
def upload_health_data():
    import pandas as pd
    if 'file' not in request.files:
        return jsonify({"error": "No file"}), 400

    file = request.files['file']
    try:
        df = pd.read_csv(file)
        health_stats = {
            "steps":     int(safe_col_mean(df, ['Step count', 'steps'])),
            "calories":  int(safe_col_mean(df, ['Calories (kcal)', 'calories'])),
            "distance":  round(safe_col_mean(df, ['Distance (m)', 'distance']), 2),
            "move_mins": int(safe_col_mean(df, ['Move Minutes count', 'move_min']))
        }
        session['extracted_health_stats'] = health_stats
        return jsonify({"success": True, "stats": health_stats})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/doctors", methods=["POST"])
def find_doctors():
    data    = request.get_json()
    pincode = str(data.get("pincode", "")).strip()
    ptype   = data.get("place_type", "All")
    spec    = data.get("specialty", "").lower().strip()

    if not (pincode.isdigit() and len(pincode) == 6):
        return jsonify({"error": "Invalid PIN code"}), 400
    try:
        geo = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"postalcode": pincode, "country": "India", "format": "json"},
            headers={"User-Agent": "corvia-flask"}, timeout=10
        ).json()
    except Exception:
        return jsonify({"error": "Location lookup failed"}), 500
    if not geo:
        return jsonify({"error": f"PIN code {pincode} not found"}), 404
    lat, lon = geo[0]["lat"], geo[0]["lon"]
    area     = geo[0]["display_name"].split(",")[0]
    tmap     = {"All":["hospital","clinic","doctors"],"Hospital":["hospital"],"Clinic":["clinic"],"Doctors":["doctors"]}
    amenities = tmap.get(ptype, ["hospital","clinic","doctors"])
    qparts    = "".join([f'node["amenity"="{a}"](around:5000,{lat},{lon});' for a in amenities])
    query     = f"[out:json];({qparts});out;"
    try:
        elements = requests.get(
            "http://overpass-api.de/api/interpreter",
            params={"data": query}, timeout=20
        ).json().get("elements", [])
    except Exception:
        return jsonify({"error": "Nearby search failed"}), 500
    results = []
    for pl in elements:
        tags = pl.get("tags", {})
        name = tags.get("name", "").strip()
        if not name: continue
        sp   = tags.get("healthcare:speciality", "General").lower()
        if spec and spec not in sp: continue
        dist = haversine(lat, lon, pl["lat"], pl["lon"])
        results.append({
            "name":        name,
            "specialty":   sp.title(),
            "distance_km": dist,
            "phone":       tags.get("phone", ""),
            "website":     tags.get("website", ""),
            "lat":         pl["lat"],
            "lon":         pl["lon"],
        })
    results = sorted(results, key=lambda x: x["distance_km"])[:12]
    return jsonify({"area": area, "pincode": pincode, "results": results,
                    "user_lat": lat, "user_lon": lon})


@app.route('/api/search_hospitals', methods=['POST'])
def search_hospitals_api():
    data = request.get_json()
    pincode = data.get('pincode')

    if not pincode:
        return jsonify({"hospitals": []}), 400

    conn_local = sqlite3.connect("hospital_db.db")
    conn_local.row_factory = sqlite3.Row
    cursor_local = conn_local.cursor()

    cursor_local.execute("""
        SELECT name, speciality, address, zipcode, phone 
        FROM hospitals 
        WHERE zipcode = ? 
        UNION ALL
        SELECT name, speciality, address, zipcode, phone 
        FROM hospitals 
        WHERE zipcode != ?
        LIMIT 5
    """, (pincode, pincode))

    rows = cursor_local.fetchall()
    hospitals = [dict(row) for row in rows]
    conn_local.close()

    return jsonify({"hospitals": hospitals})


# ════════════════════════════════════════════════════════════
#  CHAT — FIXED: system prompt passed via GenerateContentConfig
# ════════════════════════════════════════════════════════════

@app.route("/api/chat", methods=["POST"])
def chat():
    data    = request.get_json()
    message = data.get("message", "").strip()
    history = data.get("history", [])
    result  = data.get("result", None)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        return jsonify({"reply": "⚠️ GEMINI_API_KEY not configured. Add it to your .env file."})

    try:
        profile = ""
        if result:
            profile = (
                f"\nCurrent user risk profile:"
                f"\n- Age: {result.get('age')} | Sex: {result.get('sex')}"
                f"\n- 10-Year Risk: {result.get('risk')}%  ({result.get('category')})"
                f"\n- Systolic BP: {result.get('sys_bp')} mmHg"
                f"\n- Total Cholesterol: {result.get('total_chol')} mg/dL | HDL: {result.get('hdl_chol')} mg/dL"
                f"\n- Daily Steps: {result.get('steps', 0)}"
                f"\n- Smoking: {result.get('smoker')} | Diabetes: {result.get('diabetes')}"
                f"\nPersonalise answers using this profile when relevant."
            )

        system = (
            "You are CORVIA AI - a warm expert cardiovascular health assistant "
            "built into the CORVIA Heart Risk Dashboard."
            + profile +
            "\nRules:"
            "\n1. Answer ALL questions about CORVIA heart health risk scores medications diet exercise and lifestyle."
            "\n3. Refuse only truly off-topic questions with: I am CORVIA AI and I only help with heart health and CORVIA topics."
            "\n4. End health advice with: CORVIA is educational only - please consult a doctor for personal medical care."
            "\nAHA Scale: Low under 5 percent | Borderline 5 to 7.5 percent | Intermediate 7.5 to 20 percent | High 20 percent or above"
        )

        # Build multi-turn contents list for the REST API
        contents = []
        for m in history[-6:]:
            contents.append({"role": "user",  "parts": [{"text": m["user"]}]})
            contents.append({"role": "model", "parts": [{"text": m["assistant"]}]})
        contents.append({"role": "user", "parts": [{"text": message}]})

        # ✅ Direct REST call — no SDK, no version conflicts
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": contents,
        }

        resp = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            params={"key": api_key},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        data_r = resp.json()

        reply = (
            data_r.get("candidates", [{}])[0]
                  .get("content", {})
                  .get("parts", [{}])[0]
                  .get("text", "")
        )
        return jsonify({"reply": reply or "I could not generate a response. Please try again."})

    except requests.exceptions.HTTPError as e:
        err = str(e)
        if "429" in err:
            return jsonify({"reply": "⚠️ Gemini quota exceeded. Please wait and try again."})
        return jsonify({"reply": f"⚠️ API error: {err[:200]}"})
    except Exception as e:
        return jsonify({"reply": f"⚠️ Error: {str(e)[:200]}"})


# ════════════════════════════════════════════════════════════
#  HOSPITAL SEARCH — JSON + SQLite
# ════════════════════════════════════════════════════════════

@app.route("/api/search_hospital", methods=["POST"])
def search_hospital():
    data      = request.get_json()
    zipcode   = data.get("zipcode", "").strip()
    hospitals = _read_json(HOSPITALS_FILE)
    matches   = [h for h in hospitals if h.get("zipcode") == zipcode]
    if not matches:
        cursor.execute(
            "SELECT name,address,specialty,phone FROM hospitals WHERE zipcode=?", (zipcode,)
        )
        rows    = cursor.fetchall()
        matches = [{"name": r[0], "address": r[1], "specialty": r[2], "phone": r[3]} for r in rows]
    return jsonify({"hospitals": matches})


# ════════════════════════════════════════════════════════════
#  APPOINTMENT BOOKING — JSON + SQLite
# ════════════════════════════════════════════════════════════

@app.route("/api/book_appointment", methods=["POST"])
def book_appointment():
    data        = request.get_json()
    bookings    = _read_json(BOOKINGS_FILE)
    new_booking = {
        "id":            len(bookings) + 1,
        "patient_name":  data.get("patient_name", "").strip(),
        "hospital_name": data.get("hospital_name", "").strip(),
        "specialty":     data.get("specialty", "").strip(),
        "date":          data.get("date", ""),
        "time":          data.get("time", ""),
        "phone":         data.get("phone", "").strip(),
        "booked_at":     datetime.now().isoformat(),
        "status":        "pending",
    }
    if not new_booking["patient_name"] or not new_booking["hospital_name"]:
        return jsonify({"error": "Patient name and hospital name are required"}), 400
    bookings.append(new_booking)
    _write_json(BOOKINGS_FILE, bookings)
    try:
        cursor.execute(
            "INSERT INTO appointments (patient_name,hospital_name,specialty,date,time,phone) VALUES (?,?,?,?,?,?)",
            (new_booking["patient_name"], new_booking["hospital_name"],
             new_booking["specialty"],    new_booking["date"],
             new_booking["time"],         new_booking["phone"])
        )
        conn.commit()
    except Exception:
        pass
    return jsonify({
        "message": "Your appointment request has been saved. The hospital will confirm shortly.",
        "id":      new_booking["id"],
    })


@app.route("/api/view_appointments", methods=["GET"])
def view_appointments():
    bookings        = _read_json(BOOKINGS_FILE)
    bookings_sorted = sorted(bookings, key=lambda x: x.get("booked_at", ""), reverse=True)
    for b in bookings_sorted:
        b["hospital"] = b.get("hospital_name", "")
    return jsonify({"appointments": bookings_sorted})


# ════════════════════════════════════════════════════════════
#  STARTUP
# ════════════════════════════════════════════════════════════
def _startup_check():
    try:
        model, feat, enc = load_model()
        print(f"✅ Model loaded — {len(feat)} features · XGBoost ready")
    except RuntimeError as e:
        print(f"❌ {e}")
        print("   Place model files in the /models directory before starting Flask.")
    print(f"📁 Bookings file:  {BOOKINGS_FILE}")
    print(f"📁 Hospitals file: {HOSPITALS_FILE}")
    print()
    print("  Routes active:")
    print("    /  /about            → mission.html")
    print("    /mission             → about.html")
    print("    /risk-check          → risk-check.html")
    print("    /my-report           → my-report.html")
    print("    /find-hospital       → find-hospital.html")
    print("    /dashboard           → dashboard.html")
    print()
    print("  API endpoints:")
    print("    POST /api/predict")
    print("    POST /api/doctors")
    print("    POST /api/chat")
    print("    POST /api/search_hospital")
    print("    POST /api/book_appointment")
    print("    GET  /api/view_appointments")


if __name__ == "__main__":
    _startup_check()
    app.run(debug=True, port=5000)