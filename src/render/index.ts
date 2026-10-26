// Public entry point of the multiverse renderer.
import type { CreateRenderer, MultiverseRenderer } from './types'
import { Renderer } from './renderer'

export type * from './types'

export const createRenderer: CreateRenderer = (container: HTMLElement): MultiverseRenderer =>
  new Renderer(container)
