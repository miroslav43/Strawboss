import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import Handlebars from 'handlebars';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { DocumentsService } from '../documents.service';
import { UploadsService } from '../../uploads/uploads.service';
import { DocumentType, DocumentStatus } from '@strawboss/types';

interface ComandaRow {
  id: string;
  organization_id: string;
  beneficiary_id: string | null;
  company_name: string | null;
  company_cui: string | null;
  transporter_name: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  driver_name: string | null;
  truck_registration_plate: string | null;
  trailer_registration_plate: string | null;
  destination_locality: string | null;
  destination_address: string | null;
  needed_date: string | null;
  unloading_date: string | null;
  comanda_order_no: number | null;
  org_name: string;
  // order settings (LEFT JOIN — settings_id NULL ⇒ no comandă for this beneficiary)
  settings_id: string | null;
  transport_value: number | null;
  currency: string | null;
  payment_term_days: number | null;
  bale_count: number | null;
  bale_dimensions: string | null;
  goods_name: string | null;
  truck_description: string | null;
  loading_locality: string | null;
  loading_country: string | null;
  obs: string | null;
}

/**
 * Generates the "comandă" (transport order) PDF from a trip_request + the
 * per-beneficiary order settings. Same Puppeteer + Handlebars pipeline as the CMR,
 * but request-scoped and stored on the signed-uploads route (UploadsService), so it
 * serves exactly like an aviz. No-op (returns null) if the beneficiary has no order
 * settings configured.
 */
@Injectable()
export class ComandaService {
  private readonly template: HandlebarsTemplateDelegate;

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly documentsService: DocumentsService,
    private readonly uploads: UploadsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    const templatePath = join(__dirname, 'templates', 'comanda.hbs');
    this.template = Handlebars.compile(readFileSync(templatePath, 'utf-8'));
  }

  async generateComanda(orgId: string, requestId: string): Promise<{ id: string } | null> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT
            tr.id, tr.organization_id, tr.beneficiary_id,
            tr.company_name, tr.company_cui,
            tr.transporter_name,
            tr.requester_name, tr.requester_phone, tr.requester_email,
            tr.driver_name,
            tr.truck_registration_plate, tr.trailer_registration_plate,
            tr.destination_locality, tr.destination_address,
            to_char(tr.needed_date, 'DD.MM.YYYY')    AS needed_date,
            to_char(tr.unloading_date, 'DD.MM.YYYY') AS unloading_date,
            tr.comanda_order_no,
            o.name AS org_name,
            os.id AS settings_id,
            os.transport_value::float8 AS transport_value,
            os.currency, os.payment_term_days,
            os.bale_count, os.bale_dimensions, os.goods_name, os.truck_description,
            os.loading_locality, os.loading_country, os.obs
          FROM trip_requests tr
          JOIN organizations o ON o.id = tr.organization_id
          LEFT JOIN beneficiary_order_settings os
            ON os.beneficiary_id = tr.beneficiary_id
           AND os.organization_id = tr.organization_id
          WHERE tr.id = ${requestId}::uuid
            AND tr.organization_id = ${orgId}::uuid
            AND tr.deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as ComandaRow[];

    const r = rows[0];
    if (!r) return null;
    if (!r.settings_id) {
      // No order settings for this beneficiary → nothing to generate. Not an error.
      this.winston.log('flow', `Comandă skipped: no order settings`, {
        context: 'ComandaService',
        requestId,
        orgId,
      });
      return null;
    }

    // Assign the per-beneficiary order number ONCE (idempotent on regeneration).
    let orderNo = r.comanda_order_no;
    if (orderNo == null) {
      const bumped = (await this.drizzleProvider.db.execute(
        sql`UPDATE beneficiary_order_settings
            SET order_counter = order_counter + 1, updated_at = now()
            WHERE id = ${r.settings_id}::uuid
            RETURNING order_counter`,
      )) as unknown as { order_counter: number }[];
      orderNo = bumped[0]?.order_counter ?? 1;
      await this.drizzleProvider.db.execute(
        sql`UPDATE trip_requests SET comanda_order_no = ${orderNo} WHERE id = ${requestId}::uuid`,
      );
    }

    const today = new Date().toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const plates = [r.truck_registration_plate, r.trailer_registration_plate]
      .filter(Boolean)
      .join('/');
    // "33 BALOTI PAIE, 240X120X90" — count + goods, then dimensions after a comma.
    const goodsHead = [r.bale_count != null ? `${r.bale_count} BALOTI` : null, r.goods_name]
      .filter(Boolean)
      .join(' ');
    const goods = r.bale_dimensions
      ? goodsHead
        ? `${goodsHead}, ${r.bale_dimensions}`
        : r.bale_dimensions
      : goodsHead;
    const loading = [r.loading_locality, r.loading_country, r.needed_date]
      .filter(Boolean)
      .join(', ');
    const unloading = [r.destination_locality, r.unloading_date].filter(Boolean).join(', ');
    const value =
      r.transport_value != null ? `${r.transport_value} ${r.currency ?? 'EUR'}`.trim() : '';

    const html = this.template({
      expeditorName: r.company_name ?? '',
      expeditorVat: r.company_cui ?? '',
      orderNo,
      date: today,
      carrierName: r.transporter_name ?? '',
      contactName: r.requester_name ?? '',
      contactPhone: r.requester_phone ?? '',
      contactEmail: r.requester_email ?? '',
      goods,
      truckDescription: r.truck_description ?? '',
      plates,
      driverName: r.driver_name ?? '',
      loading,
      unloading,
      value,
      paymentDays: r.payment_term_days ?? 30,
      obs: r.obs ?? '',
      orgName: r.org_name,
    });

    // Render with Puppeteer (same SSRF-guarded launch as the CMR generator).
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    let pdfBuffer: Uint8Array;
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        const allowed =
          url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:');
        (allowed ? req.continue() : req.abort()).catch(() => {});
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      });
    } finally {
      await browser.close().catch(() => {});
    }

    const saved = await this.uploads.saveComanda(Buffer.from(pdfBuffer));

    // One comandă per request — retire the previous before inserting the new one.
    await this.documentsService.softDeleteByTripRequest(orgId, requestId, DocumentType.comanda);
    const docResult = (await this.documentsService.create(orgId, {
      tripRequestId: requestId,
      documentType: DocumentType.comanda,
      title: `Comandă ${orderNo}`,
      status: DocumentStatus.generated,
      fileUrl: saved.url,
      fileSizeBytes: saved.sizeBytes,
      mimeType: 'application/pdf',
      metadata: { orderNo, beneficiaryId: r.beneficiary_id },
    })) as unknown as { id: string }[];

    this.winston.log('flow', `Comandă generated: order=${orderNo}`, {
      context: 'ComandaService',
      requestId,
      orgId,
      orderNo,
    });
    return docResult[0] ?? null;
  }
}
