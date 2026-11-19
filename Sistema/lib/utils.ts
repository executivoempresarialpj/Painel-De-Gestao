import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const num = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
export const paymentLabels: Record<string,string> = { cash:"Dinheiro",pix:"Pix",debit:"Cartão de débito",credit:"Cartão de crédito" }
export const movementLabels: Record<string,string> = { opening:"Abertura",entry:"Entrada",loss:"Perda",damage:"Avaria",adjustment:"Ajuste",withdrawal:"Retirada interna",sale:"Venda",reversal:"Estorno" }
export function dayIn(zone: string) { return new Intl.DateTimeFormat("sv-SE", {timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()) }
export function showDate(date: string, zone: string) { return new Intl.DateTimeFormat("pt-BR",{timeZone:zone,dateStyle:"short",timeStyle:"short"}).format(new Date(date)) }
