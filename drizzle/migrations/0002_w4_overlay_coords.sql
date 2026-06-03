ALTER TABLE `form_field_mappings` ADD `x_coord` real;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `y_coord` real;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `font_size` real;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `field_kind` text DEFAULT 'acroform' NOT NULL;