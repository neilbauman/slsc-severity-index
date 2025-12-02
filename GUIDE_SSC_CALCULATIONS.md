# Step-by-Step Guide: Running SSC Calculations

This guide walks you through uploading household data and running severity calculations using the Excel file you shared.

## Prerequisites

1. **Run the database migration first** (if not already done):
   - Go to `/admin/migrations` in your app
   - Select `create_ssc_calculation_tables`
   - Copy the SQL and run it in Supabase SQL Editor
   - This creates the tables needed for calculations

2. **Have admin boundaries uploaded** for your country
   - Go to `/countries/[code]/admin-boundaries`
   - Upload your administrative boundaries shapefile/geojson

## Step 1: Import the Calculation Model from Excel

The Excel file you shared (`Shelter_GSC SSC Calculation tool_Mozambique_Conflict_25092024 - v2.xlsx`) contains both:
- The calculation methodology (which we'll import as a model)
- The household data (which we'll import separately)

### 1.1 Import Calculation Model

1. Navigate to your country page: `/countries/[country-code]` (e.g., `/countries/MOZ`)
2. Go to **"Calculation Models"** (or navigate to `/countries/[code]/calculation-models`)
3. Click **"Import Model"**
4. Select the Excel file: `Shelter_GSC SSC Calculation tool_Mozambique_Conflict_25092024 - v2.xlsx`
5. The system will automatically extract:
   - Core indicators (3 pillars structure)
   - Analysis grid (how to score each pillar)
   - Decision tree (how to combine pillar scores into final severity)
6. Optionally fill in:
   - Name: e.g., "Mozambique Conflict SSC Model"
   - Version: e.g., "1.0"
   - Description: e.g., "Mozambique Conflict calculation model"
7. Click **"Import Model"**

**What happens:** The system parses the Excel template and stores the calculation methodology. You should see the model appear in the list.

## Step 2: Extract and Upload Household Data

The Excel file has a sheet called **"HH dataset"** with your household survey data. You need to extract this into a separate file.

### 2.1 Extract Household Data

1. Open the Excel file: `Shelter_GSC SSC Calculation tool_Mozambique_Conflict_25092024 - v2.xlsx`
2. Find the sheet named **"HH dataset"** or **"HH Dataset"**
3. This sheet should contain:
   - Column headers (survey questions)
   - Rows of household responses
   - **Important:** Make sure there's a pcode column (e.g., `Admin1 P-Code`, `Admin2 P-Code`, or `Admin3 P-Code`)
4. **Export this sheet:**
   - Option A: Save this sheet as a new Excel file (`.xlsx`)
   - Option B: Save as CSV (`.csv`)

### 2.2 Upload Household Dataset

1. Navigate to **"Household Datasets"** (or `/countries/[code]/household-datasets`)
2. Click **"Upload Dataset"**
3. Select your extracted household data file (the "HH dataset" sheet you exported)
4. Fill in:
   - **Name:** e.g., "Mozambique Conflict Household Survey 2024"
   - **Description:** (optional)
5. Click **"Upload Dataset"**

**What happens:**
- The system processes the file
- Detects pcode columns (Admin1 P-Code, Admin2 P-Code, etc.)
- Links each household to administrative boundaries via pcode
- Stores all survey responses
- You'll see the dataset appear with the number of households processed

**Important:** Make sure your household data has:
- A pcode column that matches your admin boundaries
- All the survey question columns that the calculation model expects

## Step 3: Run the Calculation

Now that you have both the model and the data, you can run calculations.

### 3.1 Start Calculation

1. Navigate to **"Calculations"** → **"New"** (or `/countries/[code]/calculations/new`)
2. Select:
   - **Calculation Model:** Choose the model you imported in Step 1
   - **Household Dataset:** Choose the dataset you uploaded in Step 2
   - **Population Groups:** (Optional) If you want to separate by population group (e.g., "Internally displaced persons (IDP)", "Host community"), enter them comma-separated
3. Click **"Run Calculation"**

### 3.2 What Happens During Calculation

The system will:

1. **Calculate Pillar Scores** for each household:
   - **Pillar 1 (Shelter):** Scores based on shelter condition, damage, privacy, thermal comfort, security of tenure
   - **Pillar 2 (NFI/Domestic functions):** Scores based on ability to cook, store food, sleep, hygiene, electricity
   - **Pillar 3 (Services):** Scores based on access to services (health, education, water, etc.)

2. **Apply Decision Tree:** Combines the 3 pillar scores into a final severity score (1-5) using the decision tree logic from your Excel model

3. **Aggregate to Area Level:**
   - Groups households by administrative unit (pcode)
   - Applies the 20% rule to determine area severity
   - Calculates proportions in each severity phase

4. **Calculate PIN (People in Need):**
   - Counts people in phases 3, 4, and 5 (severe needs)
   - Breaks down by administrative unit and population group

### 3.3 View Results

1. Go to `/countries/[code]/calculations`
2. Find your calculation in the list (should show status "complete")
3. Click **"View"** to see:
   - Summary statistics
   - Severity breakdown by area
   - PIN figures by administrative unit
   - Household-level details

## Troubleshooting

### Problem: "No pcode field detected"
**Solution:** Make sure your household data file has columns named something like:
- `Admin1 P-Code` or `ADM1_PCODE`
- `Admin2 P-Code` or `ADM2_PCODE`
- `pcode`

### Problem: Calculation fails
**Check:**
- Does the household data have all the question columns the model expects?
- Are the question column names matching what's in the analysis grid?
- Check the calculation status - it will show errors if something went wrong

### Problem: Pillar scores not calculating
**Check:**
- Are the survey response values matching what's in the analysis grid?
- For example, if the analysis grid expects "Yes"/"No", make sure your data has exactly those values

### Problem: Households not linking to admin boundaries
**Check:**
- Do the pcodes in your household data exactly match the pcodes in your admin boundaries?
- Try checking a few pcodes manually to ensure they match

## Data Format Requirements

### Household Dataset Must Have:
- ✅ Pcode column(s) - to link to admin boundaries
- ✅ Survey question columns - matching the analysis grid in the calculation model
- ✅ Population group column (optional) - if you want to separate IDPs, host community, etc.

### Example Column Names:
- `Admin1 P-Code`, `Admin2 P-Code`, `Admin3 P-Code`
- `Q2: What type of shelter does the household currently live in?`
- `Q4. What damage does the dwelling where your household currently live have?`
- `Population Group` or similar

## Next Steps After Calculation

Once calculations are complete, you can:
1. View results on the dashboard
2. Export results (if export functionality is added)
3. Compare different calculation runs
4. Adjust the calculation model and re-run if needed

## Questions?

If you encounter issues:
1. Check the calculation status - it will show errors
2. Review the household dataset to ensure data quality
3. Verify that column names match what the model expects
4. Check that pcodes match between household data and admin boundaries

