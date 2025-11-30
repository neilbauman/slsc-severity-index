# SLSC Severity Index

Multi-Country Shelter Severity Classification Toolset

A context-agnostic platform for managing shelter severity assessments across multiple countries. Supports flexible administrative boundaries, dataset management, hazard tracking, and People in Need (PIN) calculations.

## Features

- **Multi-Country Support**: Manage multiple countries with flexible configurations
- **Administrative Boundaries**: Upload and manage admin boundaries with flexible levels and Pcode patterns
- **Dataset Management**: Upload and validate core datasets (population, pcodes) and baseline datasets
- **Hazard Management**: Track hazards and calculate affected areas
- **Severity Calculations**: Configurable calculation models for determining severity and PIN
- **Authentication & Authorization**: Public read access, authenticated users with country-specific permissions
- **Compact UI Design**: Clean, compact interface with Global Shelter Cluster branding

## Tech Stack

- **Next.js 16** with App Router
- **TypeScript**
- **Supabase** (PostgreSQL with PostGIS, Auth, Storage)
- **Tailwind CSS** with custom GSC color palette
- **React Leaflet** for maps
- **Recharts** for visualizations

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Update `.env.local` with your Supabase credentials:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

3. Run the development server:
```bash
npm run dev
```

## Database Schema

The application uses the following main tables:
- `countries` - Country configurations
- `admin_boundaries` - Administrative boundaries with PostGIS geometry
- `datasets` - Core and baseline datasets
- `hazards` - Hazard data with geometry
- `severity_calculations` - Calculation runs
- `pin_results` - People in Need results by administrative unit

## Deployment

The project is configured for Vercel deployment. Connect your GitHub repository to Vercel and set the environment variables in the Vercel dashboard.

## License

MIT
