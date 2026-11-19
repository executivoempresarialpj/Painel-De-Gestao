import {cn} from "@/lib/utils"
import type {ComponentProps} from "react"
export function Card({className,...props}:ComponentProps<"section">) {
  return <section data-slot="card" className={cn("card",className)} {...props}/>
}
