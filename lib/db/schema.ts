// lib/db/schema.ts
import {
    pgTable,
    text,
    timestamp,
    numeric,
    uniqueIndex,
  } from "drizzle-orm/pg-core";
  
  export const work_orders = pgTable(
    "work_orders",
    {
      id: text("id").primaryKey(), // you can generate uuid in app for now
      user_id: text("user_id").notNull(),
      job_id: text("job_id").notNull(),
  
      work_order_number: text("work_order_number"),
      scheduled_date: text("scheduled_date"),
      customer_name: text("customer_name"),
      service_address: text("service_address"),
      job_description: text("job_description"),
  
      amount: numeric("amount", { precision: 12, scale: 2 }),
      currency: text("currency").default("USD"),
      status: text("status").default("NEW"),
  
      created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
      updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
      user_job_unique: uniqueIndex("work_orders_user_job_unique").on(t.user_id, t.job_id),
    })
  );
  