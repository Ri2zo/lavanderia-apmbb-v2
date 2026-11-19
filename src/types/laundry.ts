export type MachineId = 'brastemp' | 'lg' | 'eletrolux'

export interface Machine {
  id: MachineId
  name: string
  description: string
}

export const machines: readonly Machine[] = [
  { id: 'brastemp', name: 'BRASTEMP', description: 'Lavadora' },
  { id: 'lg', name: 'LG', description: 'Lava e seca' },
  { id: 'eletrolux', name: 'ELETROLUX', description: 'Secadora' },
]
