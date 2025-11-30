declare module 'shapefile' {
  export interface Source {
    read(): Promise<{ done: boolean; value?: any }>
  }
  
  export function open(shp: ArrayBuffer, dbf?: ArrayBuffer): Promise<Source>
}

