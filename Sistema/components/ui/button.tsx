import {cn} from "@/lib/utils"
import type {ComponentProps} from "react"
export function Button({className, variant="default", ...props}:ComponentProps<"button"> & {variant?:"default"|"outline"|"ghost"|"danger"}) {
  return <button data-slot="button" className={cn("button",variant,className)} {...props}/>
}
