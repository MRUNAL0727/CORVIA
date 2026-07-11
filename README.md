# CORVIA - A Hybrid Machine Learning Framework for 10-Year ASCVD Risk Prediction Integrating ACC/AHA Pooled Cohort Equations with Wearable Physical Activity Data

[![Python](https://img.shields.io/badge/Python-3.9%2B-blue)](https://www.python.org/)
[![XGBoost](https://img.shields.io/badge/XGBoost-1.7.5-orange)](https://xgboost.readthedocs.io/)
[![Streamlit](https://img.shields.io/badge/Streamlit-1.28.0-red)](https://streamlit.io/)
[![Flask](https://img.shields.io/badge/Flask-2.3.0-green)](https://flask.palletsprojects.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## Overview

**CORVIA** is a hybrid machine learning platform that integrates the **2013 ACC/AHA Pooled Cohort Equations (PCE)** with **Google Fit wearable activity data** to predict an individual's 10-year risk of atherosclerotic cardiovascular disease (ASCVD). The system uses an **XGBoost regressor** trained on 50,000 NHANES-derived patient profiles and provides personalized risk assessments through a production-ready web application.

### Data Flow
<img width="300" height="auto" alt="Corvia Flowchart" src="https://github.com/user-attachments/assets/3c774f83-cb47-48e3-b636-ca2240db2b34" />

## Project Structure

| Path | Description |
|------|-------------|
| `app.py` | Main Streamlit web application |
| `train.py` | XGBoost model training script |
| `predict.py` | Model inference script |
| `requirements.txt` | Python dependencies |
| `models/heart_risk_model.json` | Trained XGBoost model |
| `models/feature_columns.pkl` | Feature column names |
| `models/label_encoder_sex.pkl` | Sex label encoder |
| `data/users_data.csv` | Simulated dataset (50,000 profiles) |
| `assets/FYP Logo.png` | CORVIA logo |
| `eda_figures/` | EDA plots and figures |

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Machine Learning** | XGBoost, Scikit-learn, Pandas, NumPy |
| **Backend** | Flask (Python) |
| **Frontend** | HTML5, CSS3, JavaScript |
| **Visualization** | Plotly, Matplotlib, Seaborn |
| **Mapping** | Folium, OpenStreetMap (Nominatim, Overpass API) |
| **PDF Generation** | jsPDF |
| **Model Serialization** | Pickle, Joblib |

## Installation & Usage

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.9+ |
| pip | Latest |

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/CORVIA.git
cd CORVIA
```

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Run the Streamlit App

```bash
streamlit run app.py
```

### Step 4: Access the Application

Open your browser and navigate to `http://localhost:8501`

## How to Use

| Step | Action |
|------|--------|
| 1 | **Enter Clinical Parameters**: Age, sex, cholesterol, blood pressure, diabetes, smoking status |
| 2 | **Upload Google Fit CSV**: Export your Google Fit data and upload the CSV file |
| 3 | **Calculate Risk**: Click "Calculate Heart Risk" to get your personalized 10-year ASCVD risk |
| 4 | **View Report**: See your risk percentage, category, and personalized recommendations |
| 5 | **Download PDF**: Save your report for personal records or to share with your doctor |
| 6 | **Find Hospitals**: Enter your pincode to locate nearby cardiology facilities |

