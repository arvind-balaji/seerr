import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIssueReplacement1793360000000 implements MigrationInterface {
  name = 'AddIssueReplacement1793360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "issue" ADD "replacement" text`);
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "autoApproveReplacements" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "autoApproveReplacements"`
    );
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "replacement"`);
  }
}
